// Loads live usage from /api/usage and the recorded samples from /api/history,
// and puts the history on one 5-minute grid shared by every account, which is
// the shape the charts draw.

export const MIN = 60e3;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const STEP = 5 * MIN; // poll interval
// A value holds until the next sample; a longer silence breaks the line.
const HOLD = 30 * MIN;

export type Key = 'h5' | 'wk';
const keys: Record<string, Key> = { '5h': 'h5', weekly: 'wk' };

const colors = [
	{ color: 'var(--color-acct-1)', track: 'var(--color-acct-1-track)' },
	{ color: 'var(--color-acct-2)', track: 'var(--color-acct-2-track)' }
];

// One window of one account from /api/usage. at is null when the reset time is unknown.
export type Window = { pct: number; at: number | null };

export type Account = {
	id: string;
	email: string;
	color: string;
	track: string;
	error: string | null;
	live: Record<Key, Window | null>;
};

// History of one account on the shared grid t; NaN where there is no data.
export type Series = Account & {
	t: Float64Array;
	h5: Float32Array;
	wk: Float32Array;
};

export type Data = { accounts: Account[]; series: Series[]; fetchedAt: number };

type UsageEntry =
	| { account: string; email: string; error: string }
	| { account: string; email: string; window: string; utilization: number; resets_at: string | null };

type History = {
	accounts: { account: string; email: string }[];
	samples: [number, number, string, number][];
};

async function get<T>(path: string): Promise<T> {
	const res = await fetch(path, { cache: 'no-store' });
	if (!res.ok) throw new Error(`${path} answered ${res.status}`);
	return res.json();
}

export async function load(): Promise<Data> {
	const [usage, history] = await Promise.all([get<UsageEntry[]>('/api/usage'), get<History>('/api/history')]);
	const fetchedAt = Date.now();

	// The cards show the accounts of /usage, sorted by email. Accounts only found
	// in the history still get their own colour for the charts.
	const byId = new Map<string, Account>();
	const account = (id: string, email: string) => {
		let a = byId.get(id);
		if (!a) {
			a = { id, email, ...colors[byId.size % colors.length], error: null, live: { h5: null, wk: null } };
			byId.set(id, a);
		}
		return a;
	};
	for (const u of usage) {
		const a = account(u.account, u.email);
		if ('error' in u) a.error = u.error;
		else if (keys[u.window]) {
			a.live[keys[u.window]] = { pct: u.utilization, at: u.resets_at ? Date.parse(u.resets_at) : null };
		}
	}
	const accounts = [...byId.values()];
	for (const h of history.accounts) account(h.account, h.email);

	return { accounts, series: grid([...byId.values()], history, fetchedAt), fetchedAt };
}

// The grid runs up to the fetch, so a silence at the end shows as a gap too.
function grid(accounts: Account[], history: History, fetchedAt: number): Series[] {
	const { samples } = history;
	if (!samples.length) return [];
	const start = Math.floor((samples[0][0] * 1000) / STEP) * STEP;
	const end = Math.ceil(Math.max(samples[samples.length - 1][0] * 1000, fetchedAt) / STEP) * STEP;
	const n = (end - start) / STEP + 1;
	const t = new Float64Array(n);
	for (let i = 0; i < n; i++) t[i] = start + i * STEP;

	const series = history.accounts.map((h) => {
		const a = accounts.find((x) => x.id === h.account)!;
		return { ...a, t, h5: new Float32Array(n).fill(NaN), wk: new Float32Array(n).fill(NaN) };
	});

	// Samples come sorted by time. Each one fills the grid from its own slot
	// until the next sample of the same line, or for HOLD at most.
	const last = new Map<string, { i: number; v: number; ts: number }>();
	const fill = (s: Series, key: Key, from: { i: number; v: number; ts: number }, to: number) => {
		const stop = Math.min(to, Math.floor((from.ts + HOLD - start) / STEP) + 1, n);
		s[key].fill(from.v, from.i, stop);
	};
	for (const [ts, idx, window, v] of samples) {
		const key = keys[window];
		const s = series[idx];
		if (!key || !s) continue;
		const ms = ts * 1000;
		const i = Math.round((ms - start) / STEP);
		const line = `${idx}:${key}`;
		const prev = last.get(line);
		if (prev) fill(s, key, prev, i);
		last.set(line, { i, v, ts: ms });
	}
	for (const [line, prev] of last) {
		const [idx, key] = line.split(':');
		fill(series[+idx], key as Key, prev, n);
	}
	return series;
}
