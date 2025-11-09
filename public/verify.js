const $ = (sel) => document.querySelector(sel);
const serialInput = $("#serialInput");
const btnSearch = $("#btnSearch");
const resultArea = $("#resultArea");

const socket = io();
socket.on("data_changed", () => {
  // 若其他裝置更新狀態，這邊同步刷新
  if (currentSerial) loadSerial(currentSerial);
});

let currentSerial = null;

async function fetchJSON(url, opts) {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

btnSearch.addEventListener("click", () => searchSerial());
serialInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchSerial();
});

async function searchSerial() {
  const serial = serialInput.value.trim();
  if (!serial) return alert("請輸入流水號！");
  try {
    const data = await fetchJSON(`/api/verify/${serial}`);
    currentSerial = serial;
    renderInfo(data);
  } catch (err) {
    resultArea.innerHTML = `<p style="color:#b65740;">查無此流水號</p>`;
  }
}

function renderInfo(d) {
  const verified = d.verified ? true : false;
  resultArea.innerHTML = `
    <div class="info-box">
      <div><b>班級：</b>${d.klass || ""}</div>
      <div><b>學號：</b>${d.student_no || ""}</div>
      <div><b>姓名：</b>${d.name || ""}</div>
      <div><b>電話：</b>${d.phone || ""}</div>
      <div><b>座位區：</b>${d.seat_area || ""}</div>
      <div class="status ${verified ? "ok" : "warn"}">
        ${verified ? "✅ 已驗票" : "🕓 未驗票"}
      </div>
    </div>
    <br>
    <button class="btn ${verified ? "warn" : "primary"}" id="btnVerify">
      ${verified ? "取消驗票" : "確認驗票"}
    </button>
  `;

  $("#btnVerify").addEventListener("click", () => toggleVerify(d.serial, verified));
}

async function toggleVerify(serial, verified) {
  try {
    if (verified) {
      await fetchJSON(`/api/verify/${serial}/uncheckin`, { method: "POST" });
      alert("已取消驗票");
    } else {
      await fetchJSON(`/api/verify/${serial}/checkin`, { method: "POST" });
      alert("驗票完成！");
    }
    resultArea.innerHTML = "";
    serialInput.value = "";
    serialInput.focus();
  } catch (err) {
    alert("操作失敗：" + err.message);
  }
}
