/*
 * สคริปต์สำหรับหน้าระบบติดตามปลั๊กไฟอัจฉริยะ
 * จำลองข้อมูลกำลังไฟ พลังงานและจำนวนรอบการทำงานต่อวัน
 */

/*
 * แก้ไขสคริปต์เพื่อติดต่อกับ API เซิร์ฟเวอร์ด้านหลัง (server.js)
 * หากการดึงข้อมูลจาก API สำเร็จ จะแสดงค่า real-time
 * หากล้มเหลว (เช่นเซิร์ฟเวอร์ไม่ทำงาน) จะใช้ข้อมูลจำลองเป็น fallback
 */

// ใช้เก็บจำนวนรอบการทำงานวันนี้
let cyclesTodayCount = 0;
// สถานะสวิตช์ก่อนหน้า (ยังเก็บไว้สำหรับแสดงสถานะ แต่ไม่ได้ใช้จับรอบอีกต่อไป)
let lastSwitchStateGlobal = null;
// ตัวหารสำหรับพลังงาน (มาจาก API)
let energyDivisorGlobal = 1000;
// ราคาหน่วยไฟ (บาทต่อ kWh)
let pricePerKWh = parseFloat(localStorage.getItem('pricePerKWh')) || 6;
// รายการรอบการทำงานทั้งหมด (เก็บใน localStorage)
let cycleRecords = JSON.parse(localStorage.getItem('cycleRecords') || '[]');

// การตรวจจับรอบการทำงานโดยใช้กำลังไฟ
// Flag ว่ากำลังทำงานหรือไม่
let isWorking = false;
// เวลาเริ่มรอบทำงาน (รูปแบบ HH:MM:SS)
let workingStartTime = null;
// พลังงานดิบตอนเริ่มรอบ
let workingStartRawEnergy = null;
// เกณฑ์กำลังไฟเพื่อเริ่มรอบ (วัตต์)
// กำหนดค่าเริ่มต้นคงที่เพื่อใช้ตรวจจับการทำงาน (ไม่แสดงให้ผู้ใช้ปรับ)
const DEFAULT_WORKING_THRESHOLD = 5;
let workingThreshold = DEFAULT_WORKING_THRESHOLD;

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

// ฟังก์ชันอัปเดตตารางรายละเอียดรอบการทำงานวันนี้
function updateRecordsTable() {
  const tbody = document.querySelector('#recordsTable tbody');
  if (!tbody) return;
  // ลบข้อมูลเดิม
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  const today = new Date().toISOString().slice(0, 10);
  // กรองเฉพาะรอบของวันนี้
  const todaysRecords = cycleRecords.filter(rec => rec.date === today);
  todaysRecords.forEach(rec => {
    const tr = document.createElement('tr');
    const tdStart = document.createElement('td');
    tdStart.textContent = rec.startTime;
    const tdEnd = document.createElement('td');
    tdEnd.textContent = rec.endTime;
    const tdEnergy = document.createElement('td');
    tdEnergy.textContent = rec.consumption.toFixed(4);
    const tdCost = document.createElement('td');
    tdCost.textContent = rec.cost.toFixed(2);
    tr.appendChild(tdStart);
    tr.appendChild(tdEnd);
    tr.appendChild(tdEnergy);
    tr.appendChild(tdCost);
    tbody.appendChild(tr);
  });
}

// ฟังก์ชันอัปเดตสรุปประจำวัน
function updateDailySummary() {
  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = cycleRecords.filter(rec => rec.date === today);
  const totalCycles = todaysRecords.length;
  const totalEnergy = todaysRecords.reduce((sum, rec) => sum + rec.consumption, 0);
  const totalCost = todaysRecords.reduce((sum, rec) => sum + rec.cost, 0);
  const cyclesEl = document.getElementById('summaryCycles');
  const energyEl = document.getElementById('summaryEnergy');
  const costEl = document.getElementById('summaryCost');
  if (cyclesEl) cyclesEl.textContent = totalCycles;
  if (energyEl) energyEl.textContent = totalEnergy.toFixed(4);
  if (costEl) costEl.textContent = totalCost.toFixed(2);
}

// ฟังก์ชันอัปเดต UI ด้วยข้อมูลที่ได้จาก API หรือ fallback
function updateUI({ power, energy, cycles, switchState, online, error }) {
  const powerEl = document.getElementById('powerValue');
  const energyEl = document.getElementById('energyValue');
  const cyclesEl = document.getElementById('cyclesValue');
  const statusEl = document.getElementById('statusValue');
  // กำหนดค่าเริ่มต้น
  if (powerEl) powerEl.textContent = '--';
  energyEl.textContent = '--';
  cyclesEl.textContent = '--';
  statusEl.textContent = 'ไม่ทราบสถานะ';
  statusEl.classList.remove('online', 'offline');
  // แสดงข้อมูลถ้าไม่มี error
  if (!error) {
    if (powerEl && power !== null && power !== undefined) {
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

  // อัปเดตสถานะการทำงาน (ทำงาน/ไม่ทำงาน)
  const workingStatusEl = document.getElementById('workingValue');
  if (workingStatusEl) {
    if (error) {
      workingStatusEl.textContent = 'ไม่ทราบ';
    } else {
      workingStatusEl.textContent = isWorking ? 'กำลังทำงาน' : 'ไม่มีการใช้งาน';
    }
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

  // อัปเดตตารางรอบทำงานและสรุป
  updateRecordsTable();
  updateDailySummary();
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
    // อัปเดตค่า energy divisor จาก API ถ้ามี
    if (typeof data.energyDivisor === 'number' && data.energyDivisor > 0) {
      energyDivisorGlobal = data.energyDivisor;
    }
    // ตรวจจับรอบการทำงานโดยพิจารณากำลังไฟ (power)
    const now = new Date();
    const nowDate = now.toISOString().slice(0, 10);
    const powerValue = typeof data.power === 'number' ? data.power : null;

    // หาก power สูงกว่าเกณฑ์ ให้ถือว่าเริ่ม/อยู่ในรอบการทำงาน
    if (powerValue !== null && powerValue > workingThreshold) {
      if (!isWorking) {
        // เริ่มรอบใหม่
        isWorking = true;
        workingStartRawEnergy = typeof data.rawEnergy === 'number' ? data.rawEnergy : null;
        workingStartTime = now.toLocaleTimeString('th-TH', { hour12: false });
      }
    } else {
      // หาก power ไม่เกินเกณฑ์ ให้ถือว่าหยุดทำงาน หากก่อนหน้านี้กำลังทำงานอยู่
      if (isWorking) {
        const endRawEnergy = typeof data.rawEnergy === 'number' ? data.rawEnergy : null;
        let consumption = 0;
        if (workingStartRawEnergy !== null && endRawEnergy !== null && endRawEnergy >= workingStartRawEnergy) {
          const consumptionRaw = endRawEnergy - workingStartRawEnergy;
          consumption = energyDivisorGlobal > 0 ? consumptionRaw / energyDivisorGlobal : 0;
        }
        const cost = consumption * pricePerKWh;
        cycleRecords.push({
          date: nowDate,
          startTime: workingStartTime,
          endTime: now.toLocaleTimeString('th-TH', { hour12: false }),
          consumption,
          cost
        });
        localStorage.setItem('cycleRecords', JSON.stringify(cycleRecords));
        cyclesTodayCount += 1;
        isWorking = false;
        workingStartRawEnergy = null;
        workingStartTime = null;
      }
    }

    // อัปเดตค่าของ cycles today ใน dailyCyclesData
    window.dailyCyclesData = window.dailyCyclesData || {};
    window.dailyCyclesData[nowDate] = cyclesTodayCount;
    updateUI({ power: data.power, energy: data.energy, cycles: cyclesTodayCount, switchState: data.switchState, online: data.online });
  } catch (err) {
    console.warn('API error:', err.message);
    // ไม่ใช้การจำลองสุ่มอีกต่อไป ให้แจ้งว่าออฟไลน์
    updateUI({ error: true });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // ตั้งค่าอินพุตราคาหน่วยไฟ
  const priceInput = document.getElementById('priceInput');
  if (priceInput) {
    priceInput.value = pricePerKWh.toFixed(2);
    priceInput.addEventListener('change', () => {
      const val = parseFloat(priceInput.value);
      if (!isNaN(val) && val >= 0) {
        pricePerKWh = val;
        localStorage.setItem('pricePerKWh', pricePerKWh);
        // อัปเดตราคาทั้งหมดในรายงาน
        // คำนวณค่าไฟใหม่สำหรับทุก record
        cycleRecords = cycleRecords.map(rec => {
          return { ...rec, cost: rec.consumption * pricePerKWh };
        });
        localStorage.setItem('cycleRecords', JSON.stringify(cycleRecords));
        updateRecordsTable();
        updateDailySummary();
      }
    });
  }
  // ปิดการตั้งค่าเกณฑ์กำลังไฟ: ไม่ทำอะไร เพราะใช้ค่าเริ่มต้นตายตัว
  // โหลดรายการรอบจาก localStorage สำหรับวันนี้
  const today = new Date().toISOString().slice(0, 10);
  const todaysRecords = cycleRecords.filter(r => r.date === today);
  cyclesTodayCount = todaysRecords.length;
  window.dailyCyclesData = window.dailyCyclesData || {};
  window.dailyCyclesData[today] = cyclesTodayCount;
  // อัปเดตตารางและสรุปครั้งแรก
  updateRecordsTable();
  updateDailySummary();
  // เริ่มดึงข้อมูลทุก 5 วินาที
  fetchStatusFromAPI();
  setInterval(fetchStatusFromAPI, 5000);
});