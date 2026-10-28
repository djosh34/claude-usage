// Fake usage history. Seeded so it looks the same on every load, but anchored
// to "now" so reset times and the time axis are always current.

export const MIN = 60e3;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const STEP = 5 * MIN; // poll interval
const SPAN = 28 * DAY; // recording started about four weeks ago

export type Key = 'h5' | 'wk';

export type Account = {
	email: string;
	color: string;
	track: string;
	seed: number;
	load: number;
	weeklyReset: { dow: number; h: number };
};

export type Series = Account & {
	t: Float64Array;
	h5: Float32Array;
	wk: Float32Array;
	fiveEnd: number;
	weekEnd: number;
};

export const accounts: Account[] = [
	{
		email: 'alex@example.com',
		color: 'var(--color-acct-1)',
		track: 'var(--color-acct-1-track)',
		seed: 7,
		load: 1.0,
		weeklyReset: { dow: 4, h: 9 }
	},
	{
		email: 'sam@example.com',
		color: 'var(--color-acct-2)',
		track: 'var(--color-acct-2-track)',
		seed: 23,
		load: 0.72,
		weeklyReset: { dow: 6, h: 14 }
	}
];

function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function nextWeekly(t: number, { dow, h }: Account['weeklyReset']) {
	const d = new Date(t);
	d.setHours(h, 0, 0, 0);
	d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
	if (d.getTime() <= t) d.setDate(d.getDate() + 7);
	return d.getTime();
}

// Working sessions drive both windows: the 5h window opens on first use and
// drops to 0 five hours later; the weekly window drops to 0 at its fixed reset.
function simulate(acct: Account, now: number): Series {
	const r = rng(acct.seed);
	const start = Math.floor((now - SPAN) / STEP) * STEP;
	const n = Math.floor((now - start) / STEP) + 1;
	const t = new Float64Array(n);
	const h5 = new Float32Array(n);
	const wk = new Float32Array(n);
	let fiveH = 0;
	let fiveEnd = 0;
	let week = 18 + r() * 10;
	let weekEnd = nextWeekly(start, acct.weeklyReset);
	let rate = 0;
	let sessionLeft = 0;
	for (let i = 0; i < n; i++) {
		const ti = start + i * STEP;
		const d = new Date(ti);
		const hr = d.getHours() + d.getMinutes() / 60;
		const awake = hr >= 8.5 && hr < 23.5;
		const lastStretch = now - ti < 100 * MIN; // both accounts are mid-session right now
		if (sessionLeft <= 0) {
			if ((awake && r() < 0.035) || lastStretch) {
				sessionLeft = (40 + r() * 140) / 5;
				rate = (0.35 + r() * 1.1) * acct.load;
			} else rate = 0;
		}
		if (fiveEnd && ti >= fiveEnd) {
			fiveH = 0;
			fiveEnd = 0;
		}
		if (ti >= weekEnd) {
			week = 0;
			weekEnd = nextWeekly(ti, acct.weeklyReset);
		}
		if (rate > 0 && sessionLeft > 0) {
			if (!fiveEnd) fiveEnd = ti + 5 * HOUR;
			const used = Math.min(rate * (0.6 + r() * 0.8), 100 - fiveH);
			fiveH += used;
			week = Math.min(100, week + used * 0.1);
			sessionLeft--;
		}
		t[i] = ti;
		h5[i] = fiveH;
		wk[i] = week;
	}
	return { ...acct, t, h5, wk, fiveEnd, weekEnd };
}

export function load(now = Date.now()): Series[] {
	return accounts.map((a) => simulate(a, now));
}
