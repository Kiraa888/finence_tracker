// ==========================================
// 1. CONFIG, UTILS & PURE LOGIC
// ==========================================
// Safe check for Chart.js
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#888890';
    Chart.defaults.font.family = 'Inter';
}

const CATEGORY_MAP = {
    'Salary': '#D4AF37', 'Freelance': '#F3E5AB', 'House': '#e74c3c', 'Rent': '#e74c3c',
    'Groceries': '#2ecc71', 'Transport': '#3498db', 'Shopping': '#9b59b6',
    'Credit Card': '#e67e22', 'Food': '#f1c40f', 'Other': '#95a5a6'
};

const PureLogic = {
    getCategoryColor: (category) => {
        if (CATEGORY_MAP[category]) return CATEGORY_MAP[category];
        let hash = 0;
        for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
        let color = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        color = '000000'.substring(0, 6 - color.length) + color;
        const num = parseInt(color, 16);
        const brightness = (((num >> 16) & 255) * 299 + ((num >> 8) & 255) * 587 + (num & 255) * 114) / 1000;
        return brightness < 80 ? '#888890' : `#${color}`;
    },
    calculateTotals: (transactions) => transactions.reduce((acc, tx) => {
        if (tx.type === "income") acc.income += tx.amount;
        else if (tx.type === "expense") acc.expense += tx.amount;
        acc.balance = acc.income - acc.expense;
        return acc;
    }, { balance: 0, income: 0, expense: 0 }),
    groupExpenses: (transactions) => transactions.filter(tx => tx.type === 'expense').reduce((acc, tx) => {
        acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
        return acc;
    }, {})
};

// Formats as INR (₹)
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', { 
        style: 'currency', 
        currency: 'INR',
        maximumFractionDigits: 2
    }).format(amount);
};

// Safe ID Generator (Replaces crypto.randomUUID to prevent mobile crashes)
const generateID = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

const DateUtils = {
    'this-month': () => {
        const now = new Date();
        return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
    },
    'last-month': () => {
        const now = new Date();
        return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
    },
    'this-year': () => {
        const now = new Date();
        return { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31, 23, 59, 59) };
    },
    'all-time': () => ({ start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) })
};

const animationFrames = new Map();
function animateValue(obj, start, end, duration) {
    if (!obj) return;
    if (animationFrames.has(obj)) cancelAnimationFrame(animationFrames.get(obj));
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const easeProgress = 1 - Math.pow(1 - progress, 4); 
        obj.textContent = formatCurrency(start + (end - start) * easeProgress);
        if (progress < 1) animationFrames.set(obj, requestAnimationFrame(step));
        else animationFrames.delete(obj);
    };
    animationFrames.set(obj, requestAnimationFrame(step));
}

// ==========================================
// 2. STORAGE & STORE
// ==========================================
const storage = {
    get: () => JSON.parse(localStorage.getItem("luxeVault_tx")) || [],
    set: (data) => localStorage.setItem("luxeVault_tx", JSON.stringify(data))
};

const store = {
    state: { 
        transactions: storage.get(), 
        filter: "this-month",
        loading: { sync: false }
    },
    listeners: {},
    subscribe(channel, fn) {
        if (!this.listeners[channel]) this.listeners[channel] = [];
        this.listeners[channel].push(fn);
    },
    notify(channel) {
        if (this.listeners[channel]) this.listeners[channel].forEach(fn => fn());
    },
    dispatch(channel, updater) {
        this.state = updater(this.state);
        if (channel === 'transactions' || channel === 'undo') {
            storage.set(this.state.transactions);
        }
        this.notify(channel);
    }
};

const createMemo = () => {
    let prevDeps = null;
    let result = null;
    return (deps, compute) => {
        const isChanged = !prevDeps || deps.some((dep, i) => dep !== prevDeps[i]);
        if (isChanged) {
            result = compute();
            prevDeps = deps;
        }
        return result;
    };
};
const filterMemo = createMemo();

// ==========================================
// 3. MUTATIONS (Capped Undo Queue & API)
// ==========================================
const api = { delay: (ms = 400) => new Promise(resolve => setTimeout(resolve, ms)) };

const undoStack = [];
const MAX_UNDO = 20;
let undoTimeout = null;

function pushUndo(tx) {
    undoStack.push(tx);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function showUndoToast() {
    const toast = document.getElementById('undo-toast');
    if(!toast) return;
    const msg = toast.querySelector('span');
    msg.textContent = undoStack.length > 1 ? `${undoStack.length} transactions removed.` : `Transaction removed.`;
    toast.classList.add('active');
    clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        toast.classList.remove('active');
        undoStack.length = 0; 
    }, 6000);
}

function handleUndo() {
    if (undoStack.length === 0) return;
    const restoredTx = undoStack.pop();
    store.dispatch('undo', state => ({ ...state, transactions: [restoredTx, ...state.transactions] }));
    const toast = document.getElementById('undo-toast');
    if (undoStack.length === 0 && toast) toast.classList.remove('active');
    else showUndoToast();
}

async function syncAction(callback) {
    store.dispatch('ui', state => ({ ...state, loading: { sync: true } }));
    await callback(); 
    await api.delay(); 
    store.dispatch('ui', state => ({ ...state, loading: { sync: false } }));
}

async function addTransaction(type, rawAmount, category) {
    const amount = parseFloat(rawAmount);
    if (!amount || isNaN(amount) || amount <= 0 || !category.trim()) return alert("Invalid data.");
    
    const tx = { id: generateID(), type, amount, category: category.trim(), date: new Date().toISOString() };
    await syncAction(async () => {
        store.dispatch('transactions', state => ({ ...state, transactions: [tx, ...state.transactions] }));
    });
}

async function updateTransaction(id, updatedData) {
    const amount = parseFloat(updatedData.amount);
    if (!amount || isNaN(amount) || amount <= 0 || !updatedData.category.trim()) return alert("Invalid data.");

    await syncAction(async () => {
        store.dispatch('transactions', state => ({
            ...state,
            transactions: state.transactions.map(tx => tx.id === id ? { ...tx, ...updatedData, amount } : tx)
        }));
    });
}

async function deleteTransaction(id) {
    const txToDelete = store.state.transactions.find(t => t.id === id);
    if (!txToDelete) return;
    
    pushUndo(txToDelete);
    await syncAction(async () => {
        store.dispatch('transactions', state => ({ ...state, transactions: state.transactions.filter(tx => tx.id !== id) }));
        showUndoToast();
    });
}

// ==========================================
// 4. SELECTORS
// ==========================================
const selectors = {
    filteredTransactions: () => filterMemo([store.state.transactions, store.state.filter], () => {
        const range = DateUtils[store.state.filter]();
        return store.state.transactions.filter(tx => {
            const txDate = new Date(tx.date);
            return txDate >= range.start && txDate <= range.end;
        });
    }),
    totals: () => PureLogic.calculateTotals(selectors.filteredTransactions()),
    expensesByCategory: () => PureLogic.groupExpenses(selectors.filteredTransactions()),
    incomeTrend: () => {
        const monthlyData = {};
        const sortedTxs = [...store.state.transactions].filter(tx => tx.type === 'income').sort((a, b) => new Date(a.date) - new Date(b.date));
        sortedTxs.forEach(tx => {
            const date = new Date(tx.date);
            const monthYear = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' }).format(date);
            monthlyData[monthYear] = (monthlyData[monthYear] || 0) + tx.amount;
        });
        return monthlyData;
    }
};

// ==========================================
// 5. RENDERERS
// ==========================================
let prevTotals = { balance: 0, income: 0, expense: 0 };
let incomeChartInstance = null;
let expenseChartInstance = null;

function renderCounters() {
    const totals = selectors.totals();
    animateValue(document.getElementById('total-balance'), prevTotals.balance, totals.balance, 800);
    animateValue(document.getElementById('total-income'), prevTotals.income, totals.income, 800);
    animateValue(document.getElementById('total-expense'), prevTotals.expense, totals.expense, 800);
    prevTotals = totals;
}

function renderTransactionList() {
    const tbody = document.getElementById('transaction-tbody');
    if(!tbody) return;
    tbody.innerHTML = '';
    const filteredTxs = selectors.filteredTransactions();
    
    if (filteredTxs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">No transactions found.</td></tr>`;
        return;
    }

    filteredTxs.forEach(tx => {
        const date = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(tx.date));
        const isIncome = tx.type === 'income';
        const formattedAmount = isIncome ? `+${formatCurrency(tx.amount)}` : `-${formatCurrency(tx.amount)}`;
        const dotColor = PureLogic.getCategoryColor(tx.category);
        
        const tr = document.createElement('tr');
        tr.setAttribute('tabindex', '0'); 
        tr.setAttribute('data-id', tx.id);
        
        tr.innerHTML = `
            <td>${date}</td>
            <td style="font-weight: 500; display: flex; align-items: center; gap: 0.5rem;">
                <div style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor};"></div>
                ${tx.category}
            </td>
            <td><span class="badge ${tx.type}">${tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</span></td>
            <td style="color: ${isIncome ? 'var(--success)' : 'var(--text-main)'}; font-weight: 600;">${formattedAmount}</td>
            <td>
                <button class="btn-icon btn-edit" data-id="${tx.id}" aria-label="Edit transaction" tabindex="-1"><i class="fa-solid fa-pen" style="pointer-events: none;"></i></button>
                <button class="btn-icon btn-delete" data-id="${tx.id}" aria-label="Delete transaction" tabindex="-1"><i class="fa-solid fa-trash" style="pointer-events: none;"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function createOrUpdateChart(instance, ctx, config) {
    if (typeof Chart === 'undefined') return null; // Safe check
    if (instance) {
        instance.data = config.data;
        if (config.options) instance.options = config.options;
        instance.update();
        return instance;
    }
    return new Chart(ctx, config);
}

function renderCharts() {
    if (typeof Chart === 'undefined') return;

    const expenses = selectors.expensesByCategory();
    const donutLabels = Object.keys(expenses);
    const donutData = Object.values(expenses);
    const chartCanvasExp = document.getElementById('expenseChart');
    const emptyMsg = document.getElementById('expense-empty');

    if(chartCanvasExp) {
        const ctxExpense = chartCanvasExp.getContext('2d');
        if (donutData.length === 0) {
            if (expenseChartInstance) { expenseChartInstance.destroy(); expenseChartInstance = null; }
            ctxExpense.canvas.style.display = 'none';
            if(emptyMsg) emptyMsg.classList.remove('hidden');
        } else {
            ctxExpense.canvas.style.display = 'block';
            if(emptyMsg) emptyMsg.classList.add('hidden');
            expenseChartInstance = createOrUpdateChart(expenseChartInstance, ctxExpense, {
                type: 'doughnut',
                data: { labels: donutLabels, datasets: [{ data: donutData, backgroundColor: donutLabels.map(PureLogic.getCategoryColor), borderWidth: 0 }] },
                options: { cutout: '75%', plugins: { legend: { position: 'bottom' } } }
            });
        }
    }

    const trendData = selectors.incomeTrend();
    const barLabels = Object.keys(trendData);
    const barData = Object.values(trendData);
    const chartCanvasInc = document.getElementById('incomeChart');

    if(chartCanvasInc) {
        const ctxIncome = chartCanvasInc.getContext('2d');
        if (barData.length === 0) {
            if (incomeChartInstance) { incomeChartInstance.destroy(); incomeChartInstance = null; }
            ctxIncome.canvas.style.display = 'none';
            return;
        }
        
        ctxIncome.canvas.style.display = 'block';
        let gradient = ctxIncome.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, '#D4AF37');
        gradient.addColorStop(1, 'rgba(212, 175, 55, 0.1)');

        incomeChartInstance = createOrUpdateChart(incomeChartInstance, ctxIncome, {
            type: 'bar',
            data: { labels: barLabels, datasets: [{ label: 'Income', data: barData, backgroundColor: gradient, borderRadius: 8 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { display: false }, x: { grid: { display: false }, border: { display: false } } } }
        });
    }
}

function renderUIState() {
    const submitBtn = document.querySelector('#tx-form button[type="submit"]');
    const syncIndicator = document.getElementById('sync-status');
    if(!submitBtn || !syncIndicator) return;
    
    if (store.state.loading.sync) {
        submitBtn.disabled = true;
        syncIndicator.classList.remove('hidden');
    } else {
        submitBtn.disabled = false;
        syncIndicator.classList.add('hidden');
    }
}

// ==========================================
// 6. EVENT CONTROLLERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    
    // Fix Navigation Links so they don't break the page
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); 
            document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
            e.target.closest('li').classList.add('active');
        });
    });

    ['transactions', 'filter', 'undo'].forEach(channel => {
        store.subscribe(channel, renderCounters);
        store.subscribe(channel, renderTransactionList);
        store.subscribe(channel, renderCharts);
    });
    store.subscribe('ui', renderUIState);

    store.notify('transactions');

    const panel = document.getElementById('transaction-panel');
    const overlay = document.getElementById('panel-overlay');
    const txForm = document.getElementById('tx-form');
    let currentMode = 'add'; 
    let editingId = null;

    const openPanel = (mode = 'add', txData = null) => {
        if(!panel || !overlay || !txForm) return;
        currentMode = mode;
        const submitBtn = txForm.querySelector('button[type="submit"]');

        if (mode === 'edit' && txData) {
            editingId = txData.id;
            document.getElementById('tx-type').value = txData.type;
            document.getElementById('tx-amount').value = txData.amount;
            document.getElementById('tx-category').value = txData.category;
            document.getElementById('panel-title').textContent = 'Edit Transaction';
            submitBtn.textContent = 'Update Vault';
        } else {
            editingId = null;
            txForm.reset();
            document.getElementById('tx-type').value = txData || 'expense';
            document.getElementById('panel-title').textContent = 'New Transaction';
            submitBtn.textContent = 'Add to Vault';
        }
        panel.classList.add('active');
        overlay.classList.add('active');
        setTimeout(() => document.getElementById('tx-amount').focus(), 100);
    };

    const closePanel = () => {
        if(!panel || !overlay || !txForm) return;
        panel.classList.remove('active');
        overlay.classList.remove('active');
        txForm.reset();
    };

    document.querySelectorAll('.period-selector button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.period-selector button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            store.dispatch('filter', (state) => ({ ...state, filter: e.target.getAttribute('data-filter') }));
        });
    });

    const btnTransfer = document.getElementById('btn-transfer');
    const btnRequest = document.getElementById('btn-request');
    const btnClosePanel = document.getElementById('btn-close-panel');
    const btnUndo = document.getElementById('btn-undo');

    if(btnTransfer) btnTransfer.addEventListener('click', () => openPanel('expense'));
    if(btnRequest) btnRequest.addEventListener('click', () => openPanel('income'));
    if(btnClosePanel) btnClosePanel.addEventListener('click', closePanel);
    if(overlay) overlay.addEventListener('click', closePanel);
    if(btnUndo) btnUndo.addEventListener('click', handleUndo);

    if(txForm) {
        txForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('tx-type').value;
            const amount = document.getElementById('tx-amount').value;
            const category = document.getElementById('tx-category').value;
            
            closePanel(); 
            if (currentMode === 'add') await addTransaction(type, amount, category);
            else if (currentMode === 'edit' && editingId) await updateTransaction(editingId, { type, amount, category });
        });
    }

    const tbody = document.getElementById('transaction-tbody');
    if(tbody) {
        tbody.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            const id = btn.getAttribute('data-id');
            if (btn.classList.contains('btn-delete')) await deleteTransaction(id);
            else if (btn.classList.contains('btn-edit')) {
                const txToEdit = store.state.transactions.find(tx => tx.id === id);
                if (txToEdit) openPanel('edit', txToEdit);
            }
        });
    }
});
