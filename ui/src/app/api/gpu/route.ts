import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import type { GpuBackend } from '@/types';

const execAsync = promisify(exec);

export async function GET() {
  try {
    const platform = os.platform();
    const isWindows = platform === 'win32';

    // Try NVIDIA first, then Intel XPU
    const hasNvidiaSmi = await checkNvidiaSmi(isWindows);
    if (hasNvidiaSmi) {
      const gpuStats = await getNvidiaGpuStats();
      return NextResponse.json({
        hasGpuTool: true,
        gpuBackend: 'nvidia' as GpuBackend,
        gpus: gpuStats,
      });
    }

    const hasXpu = await checkIntelXpu();
    if (hasXpu) {
      const gpuStats = await getIntelGpuStats();
      return NextResponse.json({
        hasGpuTool: true,
        gpuBackend: 'intel' as GpuBackend,
        gpus: gpuStats,
      });
    }

    return NextResponse.json({
      hasGpuTool: false,
      gpuBackend: 'none' as GpuBackend,
      gpus: [],
      error: 'No GPU monitoring tool found (nvidia-smi / xpu-smi)',
    });
  } catch (error) {
    console.error('Error fetching GPU stats:', error);
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

async function checkIntelXpu(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      'python -c "import torch; print(torch.xpu.is_available())"',
      { timeout: 10000 },
    );
    return stdout.trim() === 'True';
  } catch {
    return false;
  }
}

async function getIntelGpuStats() {
  const { stdout } = await execAsync(`python "${xpuInfoScript}"`, { timeout: 15000 });

  const devices: Array<{
    index: number; name: string; driver_version: string;
    total_memory: number; free_memory: number; used_memory: number;
  }> = JSON.parse(stdout.trim());

  return devices.map(dev => {
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
