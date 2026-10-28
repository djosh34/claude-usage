import { DAY, HOUR } from './data';

export const presets = [
	{ id: '1d', label: '1 day', span: DAY },
	{ id: '3d', label: '3 days', span: 3 * DAY },
	{ id: '1w', label: '1 week', span: 7 * DAY },
	{ id: '2w', label: '2 weeks', span: 14 * DAY },
	{ id: 'all', label: 'All', span: Infinity }
] as const;

export type PresetId = (typeof presets)[number]['id'];

type Saved = { preset: PresetId } | { t0: number; t1: number };

const MIN_SPAN = 2 * HOUR;

// One chart's visible time frame. Each chart owns its own and keeps it in
// localStorage, so it survives refreshes and page reloads.
export class TimeView {
	d0 = $state(0); // first sample
	d1 = $state(1); // newest sample
	t0 = $state(0);
	t1 = $state(1);
	preset = $state<PresetId | null>(null);
	private loaded = false;

	constructor(
		private storageKey: string,
		private fallback: PresetId
	) {}

	setDomain(d0: number, d1: number) {
		const keepEnd = this.t1 >= this.d1;
		const moved = d1 - this.d1;
		this.d0 = d0;
		this.d1 = d1;
		if (!this.loaded) {
			this.loaded = true;
			const saved = this.read();
			if (saved && 't0' in saved) this.set(saved.t0, saved.t1);
			else this.applyPreset(saved?.preset ?? this.fallback);
		} else if (this.preset) this.applyPreset(this.preset);
		else if (keepEnd) this.set(this.t0 + moved, this.t1 + moved); // follow "now"
		else this.set(this.t0, this.t1);
	}

	applyPreset(id: PresetId) {
		const p = presets.find((x) => x.id === id) ?? presets[0];
		this.preset = p.id;
		this.clamp(this.d1 - Math.min(p.span, this.d1 - this.d0), this.d1);
		this.write({ preset: p.id });
	}

	// Set a custom frame from a gesture.
	set(t0: number, t1: number) {
		this.preset = null;
		this.clamp(t0, t1);
		this.write({ t0: this.t0, t1: this.t1 });
	}

	// Panning may run past either end of the data by up to half the visible
	// window, so the newest (or oldest) point can sit in the middle.
	private clamp(t0: number, t1: number) {
		const full = this.d1 - this.d0;
		let span = Math.min(Math.max(t1 - t0, MIN_SPAN), full);
		if (!Number.isFinite(span)) span = full;
		let a = Math.max(t0, this.d0 - span / 2);
		if (a + span > this.d1 + span / 2) a = this.d1 + span / 2 - span;
		this.t0 = a;
		this.t1 = a + span;
	}

	private read(): Saved | null {
		try {
			const v = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
			if (v && presets.some((p) => p.id === v.preset)) return { preset: v.preset };
			if (v && Number.isFinite(v.t0) && Number.isFinite(v.t1)) return { t0: v.t0, t1: v.t1 };
		} catch {
			// Storage unavailable or corrupt: fall back to the default.
		}
		return null;
	}

	private write(v: Saved) {
		try {
			localStorage.setItem(this.storageKey, JSON.stringify(v));
		} catch {
			// Storage unavailable (e.g. private mode): the frame just won't persist.
		}
	}
}
