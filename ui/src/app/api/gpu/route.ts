import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import type { GpuBackend } from '@/types';

const execAsync = promisify(exec);

// ─── Cache ────────────────────────────────────────────────
// Cache the detected backend so we don't re-probe every request.
let cachedBackend: GpuBackend | null = null;

// TTL cache for GPU stats (avoids spawning python on every poll).
const GPU_STATS_TTL_MS = 3000;
let cachedStatsResponse: { data: unknown; expiry: number } | null = null;

export async function GET() {
  try {
    // Return cached stats if still fresh
    if (cachedStatsResponse && Date.now() < cachedStatsResponse.expiry) {
      return NextResponse.json(cachedStatsResponse.data);
    }

    const platform = os.platform();
    const isWindows = platform === 'win32';

    // Use cached backend when available to skip unnecessary probes
    if (cachedBackend === null) {
      cachedBackend = await detectBackend(isWindows);
    }

    let responseData: unknown;

    if (cachedBackend === 'nvidia') {
      const gpuStats = await getNvidiaGpuStats();
      responseData = { hasGpuTool: true, gpuBackend: 'nvidia' as GpuBackend, gpus: gpuStats };
    } else if (cachedBackend === 'intel') {
      const gpuStats = await getIntelGpuStats();
      responseData = { hasGpuTool: true, gpuBackend: 'intel' as GpuBackend, gpus: gpuStats };
    } else {
      responseData = {
        hasGpuTool: false,
        gpuBackend: 'none' as GpuBackend,
        gpus: [],
        error: 'No GPU monitoring tool found (nvidia-smi / xpu-smi)',
      };
    }

    cachedStatsResponse = { data: responseData, expiry: Date.now() + GPU_STATS_TTL_MS };
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching GPU stats:', error);
    // Reset backend cache on error so next request re-probes
    cachedBackend = null;
    return NextResponse.json(
      {
        hasGpuTool: false,
        gpuBackend: 'none' as GpuBackend,
        gpus: [],
        error: `Failed to fetch GPU stats: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}

/** Detect which GPU backend is available (run once, result is cached). */
async function detectBackend(isWindows: boolean): Promise<GpuBackend> {
  if (await checkNvidiaSmi(isWindows)) return 'nvidia';
  // For Intel XPU, getIntelGpuStats already checks availability,
  // so we do a lightweight check here.
  if (await checkIntelXpu()) return 'intel';
  return 'none';
}

// ─── NVIDIA ───────────────────────────────────────────────

async function checkNvidiaSmi(isWindows: boolean): Promise<boolean> {
  try {
    if (isWindows) {
      await execAsync('nvidia-smi -L');
    } else {
      await execAsync('which nvidia-smi');
    }
    return true;
  } catch {
    return false;
  }
}

async function getNvidiaGpuStats() {
  const command =
    'nvidia-smi --query-gpu=index,name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.total,memory.free,memory.used,power.draw,power.limit,clocks.current.graphics,clocks.current.memory,fan.speed --format=csv,noheader,nounits';

  const { stdout } = await execAsync(command, {
    env: { ...process.env, CUDA_DEVICE_ORDER: 'PCI_BUS_ID' },
  });

  return stdout
    .trim()
    .split('\n')
    .map(line => {
      const [
        index, name, driverVersion, temperature,
        gpuUtil, memoryUtil, memoryTotal, memoryFree, memoryUsed,
        powerDraw, powerLimit, clockGraphics, clockMemory, fanSpeed,
      ] = line.split(', ').map(item => item.trim());

      return {
        index: parseInt(index),
        name,
        driverVersion,
        temperature: parseInt(temperature),
        utilization: { gpu: parseInt(gpuUtil), memory: parseInt(memoryUtil) },
        memory: { total: parseInt(memoryTotal), free: parseInt(memoryFree), used: parseInt(memoryUsed) },
        power: { draw: parseFloat(powerDraw), limit: parseFloat(powerLimit) },
        clocks: { graphics: parseInt(clockGraphics), memory: parseInt(clockMemory) },
        fan: { speed: parseInt(fanSpeed) || 0 },
      };
    });
}

// ─── Intel XPU ────────────────────────────────────────────

// Path to the helper script that collects Intel XPU info via PyTorch
const xpuInfoScript = path.join(process.cwd(), 'scripts', 'xpu_info.py');

// Cache the initial Intel XPU availability check (torch import is expensive)
let intelXpuAvailable: boolean | null = null;

async function checkIntelXpu(): Promise<boolean> {
  if (intelXpuAvailable !== null) return intelXpuAvailable;
  try {
    // Use the same xpu_info.py script – if it returns a non-empty array, XPU is available.
    // This avoids a separate `python -c "import torch; ..."` call.
    const { stdout } = await execAsync(`python "${xpuInfoScript}"`, { timeout: 15000 });
    const devices = JSON.parse(stdout.trim());
    intelXpuAvailable = Array.isArray(devices) && devices.length > 0;
    // Warm the stats cache with the result we already have
    if (intelXpuAvailable) {
      cachedIntelDevices = { data: devices, expiry: Date.now() + GPU_STATS_TTL_MS };
    }
    return intelXpuAvailable;
  } catch {
    intelXpuAvailable = false;
    return false;
  }
}

// Separate cache for raw Intel device data from xpu_info.py
let cachedIntelDevices: { data: Array<{
  index: number; name: string; driver_version: string;
  total_memory: number; free_memory: number; used_memory: number;
}>; expiry: number } | null = null;

async function getIntelGpuStats() {
  let devices;
  // Reuse cached raw data if still fresh (may have been populated by checkIntelXpu)
  if (cachedIntelDevices && Date.now() < cachedIntelDevices.expiry) {
    devices = cachedIntelDevices.data;
  } else {
    const { stdout } = await execAsync(`python "${xpuInfoScript}"`, { timeout: 15000 });
    devices = JSON.parse(stdout.trim());
    cachedIntelDevices = { data: devices, expiry: Date.now() + GPU_STATS_TTL_MS };
  }

  return devices.map((dev: {
    index: number; name: string; driver_version: string;
    total_memory: number; free_memory: number; used_memory: number;
  }) => {
    const memUtil = dev.total_memory > 0 ? Math.round((dev.used_memory / dev.total_memory) * 100) : 0;
    return {
      index: dev.index,
      name: dev.name,
      driverVersion: dev.driver_version,
      temperature: 0,
      utilization: { gpu: 0, memory: memUtil },
      memory: { total: dev.total_memory, free: dev.free_memory, used: dev.used_memory },
      power: { draw: 0, limit: 0 },
      clocks: { graphics: 0, memory: 0 },
      fan: { speed: 0 },
    };
  });
}
