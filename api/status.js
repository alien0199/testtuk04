/*
 * Serverless function for Vercel to fetch the current status of a Tuya smart plug.
 *
 * This function returns JSON data with the current power (W), accumulated energy (kWh),
 * number of switch cycles today, the on/off state, and whether the device is online.
 * It uses Tuya Cloud API (OpenAPI) to authenticate and fetch device status. You must
 * define the following environment variables on Vercel:
 *   - TUYA_ACCESS_ID:    Client ID from your Tuya project
 *   - TUYA_ACCESS_SECRET: Client Secret from your Tuya project
 *   - TUYA_DEVICE_ID:    Device ID of the smart plug
 *   - TUYA_BASE_URL:     API endpoint base (e.g. https://openapi-sg.iotbing.com)
 */

import crypto from 'crypto';

// Read environment variables; fallback to hard-coded defaults for local testing
const ACCESS_ID = process.env.TUYA_ACCESS_ID || 's9qyu8s9q5mv75n8hv8g';
const ACCESS_SECRET = process.env.TUYA_ACCESS_SECRET || '8f7b9acbced34ef2aaa4baf5839fa1d0';
const DEVICE_ID = process.env.TUYA_DEVICE_ID || 'a3c777c084fb59bc3arzcp';
const BASE_URL = process.env.TUYA_BASE_URL || 'https://openapi-sg.iotbing.com';

// Helper to compute SHA256 hash of a string and return lowercase hex
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Helper to compute HMAC-SHA256 signature and return uppercase hex
function signPayload(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').toUpperCase();
}

// Read divisor for energy scaling. Some devices report add_ele in units of 0.001 kWh (scale=3),
// others may require different divisors. Allow override via env var TUYA_ENERGY_DIVISOR.
const ENERGY_DIVISOR = process.env.TUYA_ENERGY_DIVISOR
  ? parseFloat(process.env.TUYA_ENERGY_DIVISOR)
  : 1000;

// Read divisor for power scaling. Some devices report cur_power in deciwatts or other units.
// If TUYA_POWER_DIVISOR is set and greater than zero, power will be divided by this divisor.
const POWER_DIVISOR = process.env.TUYA_POWER_DIVISOR
  ? parseFloat(process.env.TUYA_POWER_DIVISOR)
  : 1;

// Fetch a new access token
async function getToken() {
  const t = String(Date.now());
  const urlPath = '/v1.0/token?grant_type=1';
  const stringToSign = `GET\n${sha256('')}\n\n${urlPath}`;
  const payload = ACCESS_ID + t + stringToSign;
  const sign = signPayload(ACCESS_SECRET, payload);
  const headers = {
    'client_id': ACCESS_ID,
    'sign': sign,
    't': t,
    'sign_method': 'HMAC-SHA256'
  };
  const res = await fetch(BASE_URL + urlPath, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`Failed to get token: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (!json.result || !json.result.access_token) {
    throw new Error('Access token missing in response');
  }
  return json.result.access_token;
}

// Fetch device status list
async function getDeviceStatus(token) {
  const t = String(Date.now());
  const urlPath = `/v1.0/iot-03/devices/${DEVICE_ID}/status`;
  const stringToSign = `GET\n${sha256('')}\n\n${urlPath}`;
  const payload = ACCESS_ID + token + t + stringToSign;
  const sign = signPayload(ACCESS_SECRET, payload);
  const headers = {
    'client_id': ACCESS_ID,
    'access_token': token,
    'sign': sign,
    't': t,
    'sign_method': 'HMAC-SHA256'
  };
  const res = await fetch(BASE_URL + urlPath, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`Failed to get device status: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.result;
}

// Fetch device details to determine online state
async function getDeviceInfo(token) {
  const t = String(Date.now());
  const urlPath = `/v1.0/devices/${DEVICE_ID}`;
  const stringToSign = `GET\n${sha256('')}\n\n${urlPath}`;
  const payload = ACCESS_ID + token + t + stringToSign;
  const sign = signPayload(ACCESS_SECRET, payload);
  const headers = {
    'client_id': ACCESS_ID,
    'access_token': token,
    'sign': sign,
    't': t,
    'sign_method': 'HMAC-SHA256'
  };
  const res = await fetch(BASE_URL + urlPath, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`Failed to get device info: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.result;
}

// Parse status list for power, energy and switch state
function parseStatus(result) {
  let power = null;
  let energy = null;
  let switchState = null;
  if (!Array.isArray(result)) return { power, energy, switchState };
  for (const dp of result) {
    const code = dp.code;
    const value = dp.value;
    if (code === 'cur_power' || code === 'power' || code === 'cur_power1') {
      power = typeof value === 'number' ? value : parseFloat(value);
    } else if (code === 'add_ele' || code === 'total_energy' || code === 'total_power') {
      energy = typeof value === 'number' ? value : parseFloat(value);
    } else if (code === 'switch' || code === 'switch_1' || code === 'switch_led') {
      switchState = value;
    }
  }
  return { power, energy, switchState };
}

// Maintain cycle counts in-memory (per deployment instance)
const cycles = {};
let lastSwitchState = null;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const token = await getToken();
    const statusList = await getDeviceStatus(token);
    const { power, energy, switchState } = parseStatus(statusList);
    let deviceInfo = null;
    try {
      deviceInfo = await getDeviceInfo(token);
    } catch (e) {
      // ignore device info errors; online will be null
    }
    // Adjust energy scale if the returned value is a large integer. Some Tuya devices
    // report energy (add_ele) in units of 0.001 kWh (scale=3, range up to 50000),
    // so 14000 means 14 kWh. If energy is large (>100), divide by 1000 to get kWh.
    // Scale power and energy using divisors. If value is null or undefined, leave as null.
    let adjustedPower = null;
    if (typeof power === 'number') {
      adjustedPower = POWER_DIVISOR > 0 ? power / POWER_DIVISOR : power;
    }
    let adjustedEnergy = null;
    if (typeof energy === 'number') {
      adjustedEnergy = ENERGY_DIVISOR > 0 ? energy / ENERGY_DIVISOR : energy;
    }
    res.status(200).json({
      power: adjustedPower,
      energy: adjustedEnergy,
      switchState,
      online: deviceInfo && typeof deviceInfo.online === 'boolean' ? deviceInfo.online : null,
      rawEnergy: typeof energy === 'number' ? energy : null
      , energyDivisor: ENERGY_DIVISOR,
      powerDivisor: POWER_DIVISOR
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}