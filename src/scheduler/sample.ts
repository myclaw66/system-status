import { listContainers, ContainerInfo } from '../monitor/docker';
import { getSystemMetrics, SystemMetrics } from '../monitor/system';
import { checkPublicIP } from '../monitor/ip';
import {
  recordContainerSamples,
  recordSystemSample,
  recordIP,
} from '../db';

export async function sampleAll() {
  // 1. Docker
  try {
    const containers = await listContainers();
    if (containers.length > 0) {
      recordContainerSamples(containers);
    }
  } catch (e: any) {
    console.error('[sample] docker failed:', e.message);
  }

  // 2. System
  try {
    const sys = await getSystemMetrics();
    recordSystemSample(sys);
  } catch (e: any) {
    console.error('[sample] system failed:', e.message);
  }

  // 3. IP
  try {
    const ip = await checkPublicIP();
    recordIP(ip.ip, ip.providers, ip.changed);
  } catch (e: any) {
    console.error('[sample] ip failed:', e.message);
  }
}
