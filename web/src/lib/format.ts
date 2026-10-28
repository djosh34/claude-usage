import { DAY, HOUR, MIN } from './data';

export const fmtTime = (t: number) =>
	new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });
export const fmtDate = (t: number) =>
	new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function fmtIn(ms: number) {
	const m = Math.max(0, Math.round(ms / MIN));
	const d = Math.floor(m / 1440);
	const h = Math.floor((m % 1440) / 60);
	const mm = m % 60;
	if (d) return `in ${d} d ${h} h`;
	if (h) return `in ${h} h ${mm} min`;
	return `in ${mm} min`;
}

export function fmtAgo(ms: number) {
	const s = Math.floor(ms / 1000);
	if (s < 2) return 'Refreshed just now';
	if (s < 60) return `Refreshed ${s} s ago`;
	return `Refreshed ${Math.floor(s / 60)} min ago`;
}

export function fmtSpan(ms: number) {
	const h = Math.round(ms / HOUR);
	if (h < 48) return `${h} hours`;
	const d = Math.round(ms / DAY);
	return `${d} days`;
}
