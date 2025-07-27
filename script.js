/*
 * สคริปต์สำหรับหน้าระบบติดตามปลั๊กไฟอัจฉริยะ
 * จำลองข้อมูลกำลังไฟ พลังงานและจำนวนรอบการทำงานต่อวัน
 */

/*
 * แก้ไขสคริปต์เพื่อติดต่อกับ API เซิร์ฟเวอร์ด้านหลัง (server.js)
 * หากการดึงข้อมูลจาก API สำเร็จ จะแสดงค่า real-time
 * หากล้มเหลว (เช่นเซิร์ฟเวอร์ไม่ทำงาน) จะใช้ข้อมูลจำลองเป็น fallback
 */

// ใช้เก็บจำนวนรอบการสวิตช์ในวันปัจจุบัน
let cyclesTodayCount = 0;
let lastSwitchStateGlobal = null;

// ข้อมูลเดโม่ (ไม่ใช้แล้ว แต่เก็บไว้เผื่อ fallback ในอนาคต)
const demoCycleData = [
  { date: '2025-07-25', cycles: 3 },
  { date: '2025-07-26', cycles: 5 },
  { date: '2025-07-27', cycles: 2 }
];

// ฟังก์ชันสร้างบรรทัดในตารางจำนวนรอบ
function appendCycleRow(date, cycles) {
  const tbody = document.querySelector('#cycleTable tbody');
  const tr = document.createElement('tr');
  const tdDate = document.createElement('td');
  tdDate.textContent = date;
  const tdCycles = document.createElement('td');
  tdCycles.textContent = cycles;
  tr.appendChild(tdDate);
  tr.appendChild(tdCycles);
  tbody.appendChild(tr);
}

// ฟังก์ชันเติมข้อมูลเดโม่ลงในตาราง (ใช้ครั้งเดียว)
function populateDemoCycles() {
  demoCycleData.forEach(item => appendCycleRow(item.date, item.cycles));
}

// ฟังก์ชันอัปเดต UI ด้วยข้อมูลที่ได้จาก API หรือ fallback
function updateUI({ power, energy, cycles, switchState, online, error }) {
  const powerEl = document.getElementById('powerValue');
  const energyEl = document.getElementById('energyValue');
  const cyclesEl = document.getElementById('cyclesValue');
  const statusEl = document.getElementById('statusValue');
  // กำหนดค่าเริ่มต้น
  powerEl.textContent = '--';
  energyEl.textContent = '--';
  cyclesEl.textContent = '--';
  statusEl.textContent = 'ไม่ทราบสถานะ';
  statusEl.classList.remove('online', 'offline');
  // แสดงข้อมูลถ้าไม่มี error
  if (!error) {
    if (power !== null && power !== undefined) {
      powerEl.textContent = power.toFixed(2);
    }
    if (energy !== null && energy !== undefined) {
      energyEl.textContent = energy.toFixed(4);
    }
    // แสดงจำนวนรอบ ถ้ามีพารามิเตอร์ cycles ใช้ตามนั้น มิฉะนั้นใช้ค่าจากตัวแปร cyclesTodayCount
    if (typeof cycles === 'number') {
      cyclesEl.textContent = cycles;
    } else {
      cyclesEl.textContent = cyclesTodayCount;
    }
    // แสดงสถานะปลั๊กตาม switchState และ online
    if (typeof switchState === 'boolean') {
      statusEl.textContent = switchState ? 'เปิด' : 'ปิด';
    } else {
      statusEl.textContent = 'ไม่ทราบสถานะ';
    }
    // สถานะออนไลน์/ออฟไลน์
    if (typeof online === 'boolean') {
      if (!online) {
        statusEl.textContent = 'ออฟไลน์';
        statusEl.classList.add('offline');
      } else {
        statusEl.classList.add('online');
      }
    }
  } else {
    // ถ้าเกิด error ให้แสดงออฟไลน์
    statusEl.textContent = 'ออฟไลน์';
    statusEl.classList.add('offline');
  }
  // อัปเดตตารางรายวัน: ลบข้อมูลเดิมก่อนแล้วเพิ่มใหม่
  const tbody = document.querySelector('#cycleTable tbody');
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  // สร้างข้อมูลจาก API ถ้ามี
  if (window.dailyCyclesData) {
    Object.keys(window.dailyCyclesData).sort().forEach(date => {
      appendCycleRow(date, window.dailyCyclesData[date]);
    });
  } else {
    populateDemoCycles();
  }
}

// ฟังก์ชันดึงข้อมูลจาก API /status
async function fetchStatusFromAPI() {
  try {
    // call serverless function under /api/status (vercel)
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('API not reachable');
    const data = await response.json();
    // เซิร์ฟเวอร์อาจส่ง error
    if (data.error) throw new Error(data.error);
    // ตรวจสอบการเปลี่ยนสถานะสวิตช์เพื่อเพิ่มรอบการทำงาน
    if (typeof data.switchState === 'boolean') {
      if (lastSwitchStateGlobal !== null && data.switchState !== lastSwitchStateGlobal) {
        cyclesTodayCount += 1;
      }
      lastSwitchStateGlobal = data.switchState;
    }
    // อัปเดตค่าของ cycles today ใน dailyCyclesData
    const today = new Date().toISOString().slice(0, 10);
    window.dailyCyclesData = window.dailyCyclesData || {};
    window.dailyCyclesData[today] = cyclesTodayCount;
    updateUI({ power: data.power, energy: data.energy, cycles: cyclesTodayCount, switchState: data.switchState, online: data.online });
  } catch (err) {
    console.warn('API error:', err.message);
    // ไม่ใช้การจำลองสุ่มอีกต่อไป ให้แจ้งว่าออฟไลน์
    updateUI({ error: true });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // เริ่มดึงข้อมูลทุก 5 วินาที
  fetchStatusFromAPI();
  setInterval(fetchStatusFromAPI, 5000);
});