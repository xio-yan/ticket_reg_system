// ===== Login System =====
async function checkLogin() {
  const ok = localStorage.getItem("auth_ok");
  if (ok === "true") {
    $("#loginScreen").style.display = "none";
    return;
  }
  $("#loginScreen").style.display = "flex";
}

async function login() {
  const pwd = $("#loginPwd").value.trim();
  try {
    await fetchJSON('/api/login', { method: 'POST', body: JSON.stringify({ password: pwd }) });
    localStorage.setItem("auth_ok", "true");
    $("#loginScreen").style.display = "none";
  } catch {
    $("#loginError").textContent = "密碼錯誤";
  }
}

async function checkSerialExists(serial, currentId=null) {
  const res = await fetchJSON(`/api/check_serial?serial=${serial}`);
  // 如果有同流水號且不是自己，就算已存在
  return res.exists && res.id !== currentId;
}


document.addEventListener("DOMContentLoaded", () => {
  $("#loginBtn").onclick = login;
  $("#loginPwd").addEventListener("keydown", e => {
    if (e.key === "Enter") login();
  });
  checkLogin();

  // ✅ 登出按鈕
  const logoutBtn = $("#logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      localStorage.removeItem("auth_ok");
      location.reload();
    };
  }
});


const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const listBody = $("#listBody");
const statPaid = $("#stat-paid");
const statUnpaid = $("#stat-unpaid");
const statTotal = $("#stat-total");
const searchInput = $("#searchInput");
const importForm = $("#importForm");
const excelFile = $("#excelFile");
const btnAdd = $("#btnAdd");
const editPhone = $("#editPhone");

const editDialog = $("#editDialog");
const editForm = $("#editForm");
const editTitle = $("#editTitle");
const editId = $("#editId");
const editKlass = $("#editKlass");
const editSno = $("#editSno");
const editName = $("#editName");
const editSeat = $("#editSeat");
const editAmount = $("#editAmount");
const editNotes = $("#editNotes");
const editSerial = $("#editSerial"); // ✅ 流水號 input
const btnDelete = $("#btnDelete");
const btnSave = $("#btnSave");

const payDialog = $("#payDialog");
const payForm = $("#payForm");
const payText = $("#payText");
const btnConfirmPay = $("#btnConfirmPay");

const cancelDialog = $("#cancelDialog");
const cancelForm = $("#cancelForm");
const cancelPwd = $("#cancelPwd");
const btnConfirmCancel = $("#btnConfirmCancel");

let currentRow = null;
let query = "";
let page = 1;
let limit = 100;

const socket = io();
socket.on('connect', () => console.log('socket connected'));
socket.on('data_changed', () => { refreshStats(); refreshList(); });

function formatCurrency(n) {
  const v = Number(n || 0);
  return v.toLocaleString('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 });
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

async function refreshStats() {
  const s = await fetchJSON('/api/stats');
  statPaid.textContent = `已付款：${s.paid}`;
  statUnpaid.textContent = `未付款：${s.unpaid}`;
  statTotal.textContent = `總數：${s.total}`;
}

function renderRows(rows) {
  listBody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement('tr');
    const status = r.paid ? `<span class="badge ok">已付款</span>` : `<span class="badge wait">未付款</span>`;
    tr.innerHTML = `
      <td>${status}</td>
      <td>${r.klass || ""}</td>
      <td>${r.student_no || ""}</td>
      <td>${r.name || ""}</td>
      <td>${r.seat_area || ""}</td>
      <td>${r.phone || ""}</td>
      <td class="right">${formatCurrency(r.amount_due)}</td>
      <td>${r.serial || ""}</td>  <!-- ✅ 顯示流水號 -->
      <td>
        <div class="actions">
          <button class="btn" data-action="edit">資料</button>
          ${r.paid
            ? `<button class="btn warn" data-action="cancel">取消付款</button>`
            : `<button class="btn primary" data-action="pay">收錢</button>`}
        </div>
      </td>
    `;
    tr.dataset.row = JSON.stringify(r);
    listBody.appendChild(tr);
  }
}

async function refreshList() {
  const rows = await fetchJSON(`/api/students?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
  renderRows(rows);
}

function debounce(fn, delay=300) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

searchInput.addEventListener('input', debounce(async (e) => {
  query = e.target.value.trim();
  await refreshList();
}, 250));

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault();
});


importForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!excelFile.files.length) return;
  const fd = new FormData();
  fd.append('file', excelFile.files[0]);
  const res = await fetch('/api/import', { method: 'POST', body: fd });
  if (!res.ok) {
    const txt = await res.text();
    alert('匯入失敗：' + txt);
    return;
  }
  const data = await res.json();
  alert(`匯入完成：新增 ${data.inserted} 筆，更新 ${data.updated} 筆`);
  excelFile.value = "";
  await refreshStats();
  await refreshList();
});

listBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tr = e.target.closest('tr');
  const row = JSON.parse(tr.dataset.row);
  currentRow = row;

  if (btn.dataset.action === 'edit') {
    openEdit(row);
  } else if (btn.dataset.action === 'pay') {
    openPay(row);
  } else if (btn.dataset.action === 'cancel') {
    openCancel(row);
  }
});

function openEdit(row) {
  editTitle.textContent = row?.id ? `編輯 ${row.name || ''}` : '新增名單';
  editId.value = row?.id || '';
  editKlass.value = row?.klass || '';
  editSno.value = row?.student_no || '';
  editName.value = row?.name || '';
  editSeat.value = row?.seat_area || '';
  editPhone.value = row?.phone || '';
  editAmount.value = row?.amount_due || 0;
  editNotes.value = row?.notes || '';
  editSerial.value = row?.serial || ""; // ✅ 顯示流水號
  editSerial.disabled = !row?.paid; // ✅ 未付款不能改

  btnDelete.style.display = row?.id ? 'inline-block' : 'none';
  editDialog.showModal();
}

btnAdd.addEventListener('click', () => openEdit(null));

btnSave.addEventListener('click', async (e) => {
  e.preventDefault();

  // ✅ 流水號驗證：若已付款則必須為4碼
if (editSerial && !editSerial.disabled) {
  const serial = editSerial.value.trim();
  if (!/^\d{4}$/.test(serial)) {
    alert("流水號必須為 4 位數字");
    return;
  }
}


  const payload = {
    klass: editKlass.value.trim(),
    student_no: editSno.value.trim(),
    name: editName.value.trim(),
    seat_area: editSeat.value.trim(),
    phone: editPhone.value.trim(),
    amount_due: Number(editAmount.value || 0),
    notes: editNotes.value.trim(),
    serial: editSerial.disabled ? null : editSerial.value.trim() // ✅ 帶入 serial
  };
  try {
    if (editId.value) {
      await fetchJSON(`/api/students/${editId.value}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await fetchJSON(`/api/students`, { method: 'POST', body: JSON.stringify(payload) });
    }
    editDialog.close();
    await refreshStats();
    await refreshList();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

btnDelete.addEventListener('click', async () => {
  if (!editId.value) return;
  if (!confirm('確定要刪除這筆資料嗎？')) return;
  try {
    await fetchJSON(`/api/students/${editId.value}`, { method: 'DELETE' });
    editDialog.close();
    await refreshStats();
    await refreshList();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
});

function openPay(row) {
  payDialog.showModal();
  payText.innerHTML = `
    確認已向「${row.name}」（${row.student_no || '無學號'}）收款 ${formatCurrency(row.amount_due)} 嗎？<br><br>
    <input id="paySerial" placeholder="輸入4位流水號" maxlength="4" style="padding:8px; width:120px; text-align:center;">
  `;

  const paySerial = document.querySelector("#paySerial");

  btnConfirmPay.onclick = async (e) => {
    e.preventDefault();
    const serial = paySerial.value;
    if (!serial || !/^\d{4}$/.test(serial)) {
      alert("請輸入4位數流水號");
      return;
    }
    try {
      await fetchJSON(`/api/students/${row.id}/pay`, { 
        method: 'POST', 
        body: JSON.stringify({ serial }) 
      });
      payDialog.close();
      await refreshStats();
      await refreshList();
    } catch (err) {
      alert('收款失敗：' + err.message);
    }
  };
}

function openCancel(row) {
  cancelPwd.value = "";
  cancelDialog.showModal();
  btnConfirmCancel.onclick = async (e) => {
    e.preventDefault();
    const pwd = cancelPwd.value;
    try {
      await fetchJSON(`/api/students/${row.id}/cancel_pay`, { method: 'POST', body: JSON.stringify({ password: pwd }) });
      cancelDialog.close();
      await refreshStats();
      await refreshList();
    } catch (err) {
      alert('取消付款失敗：' + err.message);
    }
  };
}

// initial load
(async () => {
  await refreshStats();
  await refreshList();
})();

/* ------- Dialog Close Fix ------- */
const editCancelBtn = document.querySelector("#editDialog button[value='cancel'], #editCancelBtn");
const payCancelBtn = document.querySelector("#payDialog button[value='cancel'], #payCancelBtn");
const cancelPayCancelBtn = document.querySelector("#cancelDialog button[value='cancel'], #cancelPayCancelBtn");

if (editCancelBtn) editCancelBtn.addEventListener("click", () => editDialog.close());
if (payCancelBtn) payCancelBtn.addEventListener("click", () => payDialog.close());
if (cancelPayCancelBtn) cancelPayCancelBtn.addEventListener("click", () => cancelDialog.close());



window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (editDialog.open) editDialog.close();
    if (payDialog.open) payDialog.close();
    if (cancelDialog.open) cancelDialog.close();
  }
});

/* ------- Enter behavior ------- */
editDialog.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnSave.click();
  }
});

payDialog.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnConfirmPay.click();
  }
});

cancelDialog.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    btnConfirmCancel.click();
  }
});
