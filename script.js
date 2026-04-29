<script>
/* =========================
   SIMPLE STATE ENGINE
========================= */
let transactions = JSON.parse(localStorage.getItem("vault")) || [];
let currentFilter = "all-time";

/* =========================
   UTIL
========================= */
const formatCurrency = (amt) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amt);

/* =========================
   ADD TRANSACTION
========================= */
function addTransaction(type, amount, category) {
  const tx = {
    id: Date.now(),
    type,
    amount: parseFloat(amount),
    category,
    date: Date.now(),
  };

  transactions.unshift(tx);
  save();
  render();
}

/* =========================
   DELETE
========================= */
function deleteTx(id) {
  transactions = transactions.filter((t) => t.id != id);
  save();
  render();
}

/* =========================
   SAVE
========================= */
function save() {
  localStorage.setItem("vault", JSON.stringify(transactions));
}

/* =========================
   FILTER
========================= */
function getFiltered() {
  const now = new Date();

  return transactions.filter((tx) => {
    const d = new Date(tx.date);

    if (currentFilter === "this-month")
      return d.getMonth() === now.getMonth();

    if (currentFilter === "last-month")
      return d.getMonth() === now.getMonth() - 1;

    if (currentFilter === "this-year")
      return d.getFullYear() === now.getFullYear();

    return true;
  });
}

/* =========================
   TOTALS
========================= */
function calcTotals(data) {
  let income = 0,
    expense = 0;

  data.forEach((t) => {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  });

  return {
    income,
    expense,
    balance: income - expense,
  };
}

/* =========================
   RENDER
========================= */
function render() {
  const data = getFiltered();
  const totals = calcTotals(data);

  document.getElementById("total-balance").innerText =
    formatCurrency(totals.balance);

  document.getElementById("total-income").innerText =
    formatCurrency(totals.income);

  document.getElementById("total-expense").innerText =
    formatCurrency(totals.expense);

  /* TABLE */
  const tbody = document.getElementById("transaction-tbody");
  tbody.innerHTML = "";

  data.forEach((tx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${new Date(tx.date).toLocaleDateString()}</td>
      <td>${tx.category}</td>
      <td>${tx.type}</td>
      <td>${formatCurrency(tx.amount)}</td>
      <td>
        <button onclick="deleteTx(${tx.id})">❌</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  renderCharts(data);
}

/* =========================
   CHARTS
========================= */
let incomeChart, expenseChart;

function renderCharts(data) {
  const incomeData = {};
  const expenseData = {};

  data.forEach((tx) => {
    if (tx.type === "income") {
      incomeData[tx.category] =
        (incomeData[tx.category] || 0) + tx.amount;
    } else {
      expenseData[tx.category] =
        (expenseData[tx.category] || 0) + tx.amount;
    }
  });

  /* EXPENSE PIE */
  if (expenseChart) expenseChart.destroy();

  expenseChart = new Chart(
    document.getElementById("expenseChart"),
    {
      type: "doughnut",
      data: {
        labels: Object.keys(expenseData),
        datasets: [
          {
            data: Object.values(expenseData),
          },
        ],
      },
    }
  );

  /* INCOME BAR */
  if (incomeChart) incomeChart.destroy();

  incomeChart = new Chart(
    document.getElementById("incomeChart"),
    {
      type: "bar",
      data: {
        labels: Object.keys(incomeData),
        datasets: [
          {
            data: Object.values(incomeData),
          },
        ],
      },
    }
  );
}

/* =========================
   FORM
========================= */
document.getElementById("tx-form").addEventListener("submit", (e) => {
  e.preventDefault();

  const type = document.getElementById("tx-type").value;
  const amount = document.getElementById("tx-amount").value;
  const category = document.getElementById("tx-category").value;

  if (!amount || !category) return alert("Fill all fields");

  addTransaction(type, amount, category);
  e.target.reset();
});

/* =========================
   FILTER BUTTONS
========================= */
document.querySelectorAll(".period-selector button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".period-selector button")
      .forEach((b) => b.classList.remove("active"));

    btn.classList.add("active");

    currentFilter = btn.dataset.filter;
    render();
  });
});

/* =========================
   INIT
========================= */
render();
</script>
