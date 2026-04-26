/**
 * ==========================================================================
 * 1. CONFIGURATION & UTILITIES
 * ==========================================================================
 */
const CONFIG = {
    THRESHOLDS: { warning: 80, danger: 100 },
    BUDGETS: { food: 5000, transport: 3000, bills: 4000, shopping: 2000, entertainment: 2000 },
    CATEGORIES: {
        expense: [
            { id: 'food', icon: '🍔', label: 'Food & Dining' },
            { id: 'transport', icon: '🚗', label: 'Transport' },
            { id: 'bills', icon: '💡', label: 'Bills & Utilities' },
            { id: 'shopping', icon: '🛍️', label: 'Shopping' },
            { id: 'entertainment', icon: '🎬', label: 'Entertainment' }
        ],
        income: [
            { id: 'salary', icon: '💰', label: 'Salary' },
            { id: 'freelance', icon: '💻', label: 'Freelance' }
        ]
    }
};

const ErrorBoundary = (fn, fallbackMsg = "An error occurred") => {
    return (...args) => {
        try {
            return fn(...args);
        } catch (error) {
            console.error("[FinanceOS Error]:", error);
            ToastService.show(fallbackMsg, 'error');
        }
    };
};

const debounce = (func, delay) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => func(...args), delay); };
};

/**
 * ==========================================================================
 * 2. CORE SERVICES
 * ==========================================================================
 */
const StorageService = {
    get: (key, fallback) => JSON.parse(localStorage.getItem(key)) || fallback,
    set: (key, value) => localStorage.setItem(key, JSON.stringify(value))
};

const ToastService = {
    container: document.getElementById('toast-container'),
    show(message, type = 'success', actionConfig = null) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'circle-exclamation' : 'bell';
        
        let actionHTML = '';
        if (actionConfig) actionHTML = `<button class="toast-action" id="toast-btn-${actionConfig.id}">${actionConfig.label}</button>`;

        toast.innerHTML = `<i class="fa-solid fa-${icon}"></i> <span>${message}</span> ${actionHTML}`;
        this.container.appendChild(toast);

        if (actionConfig) {
            document.getElementById(`toast-btn-${actionConfig.id}`).addEventListener('click', () => {
                actionConfig.onClick();
                toast.remove();
            });
        }

        setTimeout(() => { toast.style.opacity = 0; setTimeout(() => toast.remove(), 300); }, 4000);
    }
};

const ModalService = {
    activeModal: null,
    init() {
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.activeModal) this.close(); });
        document.querySelectorAll('.modal-close-btn').forEach(btn => { btn.addEventListener('click', () => this.close()); });
    },
    open(modalId) {
        this.activeModal = document.getElementById(modalId);
        if(!this.activeModal) return;
        this.activeModal.classList.remove('hidden');
        setTimeout(() => this.activeModal.classList.add('visible'), 10);
    },
    close() {
        if (!this.activeModal) return;
        this.activeModal.classList.remove('visible');
        setTimeout(() => { this.activeModal.classList.add('hidden'); this.activeModal = null; }, 200);
    }
};

/**
 * ==========================================================================
 * 3. STATE MACHINE (Mini-Redux)
 * ==========================================================================
 */
const Store = {
    state: {
        transactions: StorageService.get('fin_data', []),
        theme: StorageService.get('fin_theme', 'light'),
        activeView: StorageService.get('fin_view', 'dashboard-view'),
        dateFilter: 'month',
        searchQuery: '',
        deletedCache: null,
        warnedBudgets: new Set()
    },
    
    dispatch: ErrorBoundary((action, payload) => {
        let newState = { ...Store.state };

        switch (action) {
            case 'ADD_TX':
                newState.transactions = [...newState.transactions, payload]; break;
            case 'DELETE_TX':
                newState.deletedCache = newState.transactions.find(t => t.id === payload);
                newState.transactions = newState.transactions.filter(t => t.id !== payload); break;
            case 'UNDO_DELETE':
                if (newState.deletedCache) {
                    newState.transactions = [...newState.transactions, newState.deletedCache];
                    newState.deletedCache = null;
                } break;
            case 'WIPE_DATA':
                newState.transactions = [];
                newState.deletedCache = null;
                newState.warnedBudgets.clear();
                break;
            case 'SET_THEME': newState.theme = payload; break;
            case 'SET_VIEW': newState.activeView = payload; break;
            case 'SET_FILTER': newState.dateFilter = payload; break;
            case 'SET_SEARCH': newState.searchQuery = payload; break;
            default: throw new Error("Unknown action type");
        }

        Store.state = newState;
        Store.persist();
        App.render();
    }, "State update failed"),

    persist() {
        StorageService.set('fin_data', this.state.transactions);
        StorageService.set('fin_theme', this.state.theme);
        StorageService.set('fin_view', this.state.activeView);
    },

    getFilteredData() {
        let data = [...this.state.transactions];
        const now = new Date();
        data = data.filter(t => {
            if (this.state.dateFilter === 'all') return true;
            const tDate = new Date(t.date);
            return tDate.getMonth() === now.getMonth() && tDate.getFullYear() === now.getFullYear();
        });
        if (this.state.searchQuery) {
            const q = this.state.searchQuery.toLowerCase();
            data = data.filter(t => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
        }
        return data.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
};

/**
 * ==========================================================================
 * 4. DOM RENDERERS & DATA VISUALIZATION
 * ==========================================================================
 */
const DOM = {
    pieChart: null, trendChart: null,

    initUI() {
        document.documentElement.setAttribute('data-theme', Store.state.theme);
        document.getElementById('global-date-filter').value = Store.state.dateFilter;
        const typeSelect = document.getElementById('type');
        const catSelect = document.getElementById('category');
        typeSelect.addEventListener('change', (e) => {
            catSelect.innerHTML = '';
            CONFIG.CATEGORIES[e.target.value].forEach(cat => catSelect.add(new Option(cat.label, cat.id)));
        });
        typeSelect.dispatchEvent(new Event('change'));
    },

    renderTransactions: ErrorBoundary((transactions) => {
        const list = document.getElementById('transaction-list');
        list.innerHTML = '';
        
        if (!transactions.length) {
            list.innerHTML = `<div class="empty-state-container" style="padding: 2rem; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i><p>No transactions found.</p></div>`;
            return;
        }

        transactions.forEach((t, index) => {
            const isInc = t.type === 'income';
            const cat = CONFIG.CATEGORIES[t.type].find(c => c.id === t.category);
            const li = document.createElement('li');
            li.className = `transaction-item list-enter`;
            li.style.animationDelay = `${(index % 10) * 30}ms`; 
            
            li.innerHTML = `
                <div class="trans-left">
                    <div class="cat-icon" style="background: ${isInc ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}; color: ${isInc ? 'var(--success)' : 'var(--danger)'}">
                        ${cat ? cat.icon : '📝'}
                    </div>
                    <div class="trans-details"><strong>${t.description}</strong><span class="trans-meta">${t.date}</span></div>
                </div>
                <div class="trans-right">
                    <div class="trans-amount ${isInc ? 'text-success' : 'text-danger'}">${isInc ? '+' : '-'}₹${t.amount.toLocaleString()}</div>
                    <button class="action-btn delete-btn" data-id="${t.id}"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            list.appendChild(li);
        });
    }),

    renderBudgets: ErrorBoundary((transactions) => {
        const list = document.getElementById('budget-list');
        list.innerHTML = '';
        const expenses = transactions.filter(t => t.type === 'expense');
        const spent = expenses.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + t.amount; return acc; }, {});

        Object.keys(CONFIG.BUDGETS).forEach(catId => {
            const limit = CONFIG.BUDGETS[catId];
            const currentSpent = spent[catId] || 0;
            const percentage = Math.min((currentSpent / limit) * 100, 100);
            const conf = CONFIG.CATEGORIES.expense.find(c => c.id === catId);
            
            let status = 'normal';
            if (percentage >= CONFIG.THRESHOLDS.danger) {
                status = 'danger';
                if (!Store.state.warnedBudgets.has(catId) && currentSpent > 0) {
                    ToastService.show(`Budget Exceeded: ${conf.label}`, 'error');
                    Store.state.warnedBudgets.add(catId);
                }
            } else if (percentage >= CONFIG.THRESHOLDS.warning) { status = 'warning'; }

            list.innerHTML += `
                <div class="budget-item">
                    <div class="budget-info"><span>${conf ? conf.label : catId}</span><span>₹${currentSpent.toLocaleString()} / ₹${limit.toLocaleString()}</span></div>
                    <div class="budget-bar-bg"><div class="budget-bar-fill ${status}" style="width: ${percentage}%"></div></div>
                </div>
            `;
        });
    }),

    renderCharts: ErrorBoundary((transactions) => {
        if (Store.state.activeView !== 'analytics-view') return;
        const expenses = transactions.filter(t => t.type === 'expense');
        
        const catTotals = expenses.reduce((acc, t) => { 
            const label = CONFIG.CATEGORIES.expense.find(c => c.id === t.category)?.label || t.category;
            acc[label] = (acc[label] || 0) + t.amount; return acc; 
        }, {});
        
        if (DOM.pieChart) DOM.pieChart.destroy();
        DOM.pieChart = new Chart(document.getElementById('expenseChart'), {
            type: 'doughnut',
            data: { 
                labels: Object.keys(catTotals).length ? Object.keys(catTotals) : ['No Data'], 
                datasets: [{ data: Object.values(catTotals).length ? Object.values(catTotals) : [1], backgroundColor: Object.keys(catTotals).length ? ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'] : ['#e2e8f0'], borderWidth: 0 }] 
            },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
        });

        const recentExpenses = expenses.slice(0, 7).reverse();
        const dates = recentExpenses.map(t => t.date.split('-').slice(1).join('/'));
        const amounts = recentExpenses.map(t => t.amount);
        
        if (DOM.trendChart) DOM.trendChart.destroy();
        DOM.trendChart = new Chart(document.getElementById('trendChart'), {
            type: 'line',
            data: { 
                labels: dates.length ? dates : ['No Data'], 
                datasets: [{ label: 'Daily Expense', data: amounts.length ? amounts : [0], borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', tension: 0.4, fill: true }] 
            },
            options: { maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    })
};

/**
 * ==========================================================================
 * 5. APPLICATION BOOTSTRAP & CONTROLLER
 * ==========================================================================
 */
const App = {
    init() {
        setTimeout(() => {
            const loader = document.getElementById('app-loader');
            const root = document.getElementById('app-root');
            if(loader) loader.style.opacity = '0';
            setTimeout(() => {
                if(loader) loader.style.display = 'none';
                if(root) { root.style.opacity = '1'; root.style.transition = 'opacity 0.5s ease'; }
            }, 500);
        }, 800);

        ModalService.init(); DOM.initUI(); this.bindEvents();
        document.getElementById('date').valueAsDate = new Date();
        this.switchView(Store.state.activeView); this.render();
    },

    render: ErrorBoundary(() => {
        const data = Store.getFilteredData();
        const inc = data.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
        const exp = data.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

        document.getElementById('balance-amount').innerText = `₹${(inc - exp).toLocaleString('en-IN')}`;
        document.getElementById('income-amount').innerText = `₹${inc.toLocaleString('en-IN')}`;
        document.getElementById('expense-amount').innerText = `₹${exp.toLocaleString('en-IN')}`;

        DOM.renderTransactions(data); DOM.renderBudgets(data); DOM.renderCharts(data);
    }),

    switchView(targetId) {
        document.querySelectorAll('.view-container').forEach(v => { v.classList.remove('active'); v.classList.add('hidden'); });
        document.querySelectorAll('.tab-btn').forEach(b => { b.classList.toggle('active', b.dataset.target === targetId); });
        const view = document.getElementById(targetId);
        view.classList.remove('hidden');
        setTimeout(() => { view.classList.add('active'); if (targetId === 'analytics-view') App.render(); }, 10);
        Store.dispatch('SET_VIEW', targetId);
    },

    handleExport() {
        const format = document.getElementById('export-format').value;
        const data = Store.getFilteredData();
        if(!data.length) return ToastService.show('No data to export', 'error');

        let content, mime, ext;
        if (format === 'json') { content = JSON.stringify(data, null, 2); mime = 'application/json'; ext = 'json'; } 
        else {
            const headers = 'Date,Type,Category,Description,Amount\n';
            content = headers + data.map(t => `${t.date},${t.type},${t.category},"${t.description}",${t.amount}`).join('\n');
            mime = 'text/csv'; ext = 'csv';
        }

        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `FinanceOS_Export_${new Date().toISOString().split('T')[0]}.${ext}`;
        link.click(); ModalService.close(); ToastService.show('Export successful!');
    },

    bindEvents() {
        // Form Submit
        document.getElementById('transaction-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('amount').value);
            if (amount <= 0) return ToastService.show('Amount must be positive', 'error');

            Store.dispatch('ADD_TX', {
                id: Date.now(), type: document.getElementById('type').value, category: document.getElementById('category').value,
                amount: amount, date: document.getElementById('date').value, description: document.getElementById('desc').value.trim()
            });
            e.target.reset(); document.getElementById('date').valueAsDate = new Date(); ToastService.show('Transaction Saved');
        });

        // Delete List Item
        document.getElementById('transaction-list').addEventListener('click', (e) => {
            const delBtn = e.target.closest('.delete-btn');
            if (delBtn) {
                Store.dispatch('DELETE_TX', Number(delBtn.dataset.id));
                ToastService.show('Record deleted', 'error', { id: 'undo-btn', label: 'UNDO', onClick: () => Store.dispatch('UNDO_DELETE') });
            }
        });

        // Filters
        document.getElementById('filter-text').addEventListener('input', debounce((e) => { Store.dispatch('SET_SEARCH', e.target.value); }, 300));
        document.getElementById('global-date-filter').addEventListener('change', (e) => { Store.dispatch('SET_FILTER', e.target.value); });
        document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', (e) => this.switchView(e.target.dataset.target)); });

        // Theme
        document.getElementById('theme-toggle').addEventListener('click', () => {
            const newTheme = Store.state.theme === 'light' ? 'dark' : 'light';
            Store.dispatch('SET_THEME', newTheme);
            document.documentElement.setAttribute('data-theme', newTheme);
            if (DOM.pieChart) App.render(); 
        });

        // Modals (Export & Wipe)
        document.getElementById('open-export-btn').addEventListener('click', () => ModalService.open('export-modal'));
        document.getElementById('confirm-export-btn').addEventListener('click', () => this.handleExport());
        
        document.getElementById('open-wipe-btn').addEventListener('click', () => ModalService.open('wipe-modal'));
        document.getElementById('confirm-wipe-btn').addEventListener('click', () => {
            Store.dispatch('WIPE_DATA');
            ModalService.close();
            ToastService.show('All account data has been wiped.', 'success');
        });
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
