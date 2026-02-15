const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const DEFAULTS = {
	alertChannelId: '',
	intervalSec: 60,
	notifyCooldownSec: 600,
	diskPath: '/',
	thresholds: {
		ioWaitMin: 20,
		memFreePercentMin: 5,
	},
};

function mergeMonitoringConfig(input) {
	const config = input || {};
	const thresholds = config.thresholds || {};

	return {
		alertChannelId: typeof config.alertChannelId === 'string' ? config.alertChannelId : DEFAULTS.alertChannelId,
		intervalSec: Number.isFinite(config.intervalSec) ? config.intervalSec : DEFAULTS.intervalSec,
		notifyCooldownSec: Number.isFinite(config.notifyCooldownSec) ? config.notifyCooldownSec : DEFAULTS.notifyCooldownSec,
		diskPath: typeof config.diskPath === 'string' && config.diskPath ? config.diskPath : DEFAULTS.diskPath,
		thresholds: {
			ioWaitMin: Number.isFinite(thresholds.ioWaitMin) ? thresholds.ioWaitMin : DEFAULTS.thresholds.ioWaitMin,
			memFreePercentMin: Number.isFinite(thresholds.memFreePercentMin) ? thresholds.memFreePercentMin : DEFAULTS.thresholds.memFreePercentMin,
		},
	};
}

function parseVmstatLine(line) {
	const parts = line.trim().split(/\s+/).map(Number);
	// r b swpd free buff cache si so bi bo in cs us sy id wa st
	if (parts.length < 17 || parts.some(Number.isNaN)) {
		throw new Error(`vmstat parse failed: ${line}`);
	}

	return {
		r: parts[0],
		b: parts[1],
		swpd: parts[2],
		free: parts[3],
		buff: parts[4],
		cache: parts[5],
		si: parts[6],
		so: parts[7],
		bi: parts[8],
		bo: parts[9],
		in: parts[10],
		cs: parts[11],
		us: parts[12],
		sy: parts[13],
		id: parts[14],
		wa: parts[15],
		st: parts[16],
	};
}

function getVmstat() {
	const output = execFileSync('vmstat', ['1', '2'], { encoding: 'utf8' });
	const lines = output.trim().split(/\n/);
	const dataLine = lines[lines.length - 1];
	return parseVmstatLine(dataLine);
}

function getMeminfo() {
	const content = fs.readFileSync('/proc/meminfo', 'utf8');
	let totalKb = 0;
	let availableKb = 0;

	for (const line of content.split(/\n/)) {
		if (line.startsWith('MemTotal:')) {
			totalKb = Number(line.replace(/[^0-9]/g, ''));
		}
		if (line.startsWith('MemAvailable:')) {
			availableKb = Number(line.replace(/[^0-9]/g, ''));
		}
	}

	if (!totalKb || !availableKb) {
		throw new Error('meminfo parse failed');
	}

	const freePercent = (availableKb / totalKb) * 100;
	return { totalKb, availableKb, freePercent };
}

function getDiskUsage(path) {
	const output = execFileSync('df', ['-P', path], { encoding: 'utf8' });
	const lines = output.trim().split(/\n/);
	if (lines.length < 2) {
		throw new Error(`df parse failed: ${output}`);
	}

	const fields = lines[1].trim().split(/\s+/);
	const usedPercentRaw = fields[4] || '';
	const usedPercent = Number(usedPercentRaw.replace('%', ''));
	if (!Number.isFinite(usedPercent)) {
		throw new Error(`df parse failed: ${lines[1]}`);
	}

	return { usedPercent };
}

function getSystemStats(config) {
	const vmstat = getVmstat();
	const mem = getMeminfo();
	const disk = getDiskUsage(config.diskPath);

	return {
		timestamp: new Date().toISOString(),
		vmstat,
		mem,
		disk,
	};
}

function checkThresholds(stats, thresholds) {
	const reasons = [];
	const { vmstat, mem } = stats;

	if (vmstat.wa > thresholds.ioWaitMin) {
		reasons.push(`I/O wait high (wa=${vmstat.wa}%)`);
	}

	if (vmstat.si > 0 || vmstat.so > 0) {
		reasons.push(`Swap activity (si=${vmstat.si}, so=${vmstat.so})`);
	}

	if (mem.freePercent < thresholds.memFreePercentMin) {
		reasons.push(`Memory low (free=${mem.freePercent.toFixed(1)}%)`);
	}

	return reasons;
}

function formatStats(stats) {
	const { vmstat, mem, disk } = stats;
	const lines = [
		`CPU: us=${vmstat.us}% sy=${vmstat.sy}% id=${vmstat.id}% wa=${vmstat.wa}%`,
		`Swap: swpd=${vmstat.swpd} si=${vmstat.si} so=${vmstat.so}`,
		`Memory: free=${mem.freePercent.toFixed(1)}% (avail=${Math.round(mem.availableKb / 1024)}MB)`,
		`Disk: used=${disk.usedPercent}%`,
	];

	return lines.join('\n');
}

module.exports = {
	mergeMonitoringConfig,
	getSystemStats,
	checkThresholds,
	formatStats,
};
