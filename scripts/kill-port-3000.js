const { execSync } = require('child_process');

const PORT = 3000;

function getOwningProcesses(port) {
  try {
    const output = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString();

    return Array.from(new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid)
    ));
  } catch {
    return [];
  }
}

function killProcessTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const pids = getOwningProcesses(PORT);

if (pids.length === 0) {
  console.log(`[port-clean] port ${PORT} is already free`);
  process.exit(0);
}

for (const pid of pids) {
  const killed = killProcessTree(pid);
  if (killed) {
    console.log(`[port-clean] cleared port ${PORT} by terminating PID ${pid}`);
  } else {
    console.warn(`[port-clean] failed to terminate PID ${pid} on port ${PORT}`);
  }
}
