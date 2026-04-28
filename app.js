// ==========================================
// 1. CONFIG, UTILS & PURE LOGIC
// ==========================================
Chart.defaults.color = '#888890';
Chart.defaults.font.family = 'Inter';

const CATEGORY_MAP = {
    'Salary': '#D4AF37', 'Freelance': '#F3E5AB', 'House': '#e74c3c',
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

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

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
// 2. STORAGE, STORE & MEMO FACTORY
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
// 3. MUTATIONS (Undo Queue & Optimistic API)
// ==========================================
const api = { delay: (ms = 600) => new Promise(resolve => setTimeout(resolve, ms)) };

const undoStack = [];
const MAX_UNDO = 20;
let undoTimeout = null;

function pushUndo(tx) {
    undoStack.push(tx);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function showUndoToast() {
    const toast = document.getElementById('undo-toast');
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
    
    store.dispatch('undo', state => ({
        ...state,
        transactions: [restoredTx, ...state.transactions] 
    }));

    if (undoStack.length === 0) document.getElementById('undo-toast').classList.remove('active');
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
    
    const tx = { id: crypto.randomUUID(), type, amount, category: category.trim(), date: new Date().toISOString() };
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
        store.dispatch('transactions', state => ({
            ...state,
            transactions: state.transactions.filter(tx => tx.id !== id)
        }));
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
            const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(date);
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
    tbody.innerHTML = '';
    const filteredTxs = selectors.filteredTransactions();
    
    if (filteredTxs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">No transactions found.</td></tr>`;
        return;
    }

    filteredTxs.forEach(tx => {
        const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(tx.date));
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
    if (instance) {
        instance.data = config.data;
        if (config.options) instance.options = config.options;
        instance.update();
        return instance;
    }
    return new Chart(ctx, config);
}

function renderCharts() {
    const expenses = selectors.expensesByCategory();
    const donutLabels = Object.keys(expenses);
    const donutData = Object.values(expenses);
    const ctxExpense = document.getElementById('expenseChart').getContext('2d');
    const emptyMsg = document.getElementById('expense-empty');

    if (donutData.length === 0) {
        if (expenseChartInstance) { expenseChartInstance.destroy(); expenseChartInstance = null; }
        ctxExpense.canvas.style.display = 'none';
        emptyMsg.classList.remove('hidden');
    } else {
        ctxExpense.canvas.style.display = 'block';
        emptyMsg.classList.add('hidden');
        expenseChartInstance = createOrUpdateChart(expenseChartInstance, ctxExpense, {
            type: 'doughnut',
            data: { labels: donutLabels, datasets: [{ data: donutData, backgroundColor: donutLabels.map(PureLogic.getCategoryColor), borderWidth: 0 }] },
            options: { cutout: '75%', plugins: { legend: { position: 'bottom' } } }
        });
    }

    const trendData = selectors.incomeTrend();
    const barLabels = Object.keys(trendData);
    const barData = Object.values(trendData);
    const ctxIncome = document.getElementById('incomeChart').getContext('2d');

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

function renderUIState() {
    const submitBtn = document.querySelector('#tx-form button[type="submit"]');
    const syncIndicator = document.getElementById('sync-status');
    
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

    const trapFocus = (e) => {
        const focusable = panel.querySelectorAll('input, select, button:not([disabled])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        
        if (e.key === 'Tab') {
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } 
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };

    const openPanel = (mode = 'add', txData = null) => {
        currentMode = mode;
        const submitBtn = txForm.querySelector('button[type="submit"]');

        if (mode === 'edit' && txData) {
            editingId = txData.id;
            document.getElementById('tx-type').value = txData.type;
            document.getElementById('tx-amount').value = txData.amount;
            document.getElementById('tx-category').value = txData.category;
            document.querySelector('.panel-header h2').textContent = 'Edit Transaction';
            submitBtn.textContent = 'Update Vault';
        } else {
            editingId = null;
            txForm.reset();
            document.getElementById('tx-type').value = txData || 'expense';
            document.querySelector('.panel-header h2').textContent = 'New Transaction';
            submitBtn.textContent = 'Add to Vault';
        }
        panel.classList.add('active');
        overlay.classList.add('active');
        panel.addEventListener('keydown', trapFocus);
        document.getElementById('tx-amount').focus();
    };

    const closePanel = () => {
        panel.classList.remove('active');
        overlay.classList.remove('active');
        panel.removeEventListener('keydown', trapFocus);
        txForm.reset();
    };

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('active')) closePanel(); });

    document.querySelectorAll('.period-selector button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.period-selector button').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            store.dispatch('filter', (state) => ({ ...state, filter: e.target.getAttribute('data-filter') }));
        });
    });

    document.getElementById('btn-transfer').addEventListener('click', () => openPanel('expense'));
    document.getElementById('btn-request').addEventListener('click', () => openPanel('income'));
    document.getElementById('btn-close-panel').addEventListener('click', closePanel);
    overlay.addEventListener('click', closePanel);

    document.getElementById('btn-undo').addEventListener('click', handleUndo);

    txForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('tx-type').value;
        const amount = document.getElementById('tx-amount').value;
        const category = document.getElementById('tx-category').value;
        
        closePanel(); 
        if (currentMode === 'add') await addTransaction(type, amount, category);
        else if (currentMode === 'edit' && editingId) await updateTransaction(editingId, { type, amount, category });
    });

    const tbody = document.getElementById('transaction-tbody');
    
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

    tbody.addEventListener('keydown', async (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        
        const id = row.getAttribute('data-id');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = row.nextElementSibling;
            if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = row.previousElementSibling;
            if (prev) prev.focus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const txToEdit = store.state.transactions.find(tx => tx.id === id);
            if (txToEdit) openPanel('edit', txToEdit);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            await deleteTransaction(id);
            const nextFocus = row.nextElementSibling || row.previousElementSibling;
            if (nextFocus) nextFocus.focus();
        }
    });
});
