<script lang="ts">
	import { untrack } from 'svelte';
	import { DAY, HOUR, STEP, type Key, type Series } from './data';
	import { fmtDate, fmtDay, fmtTime } from './format';
	import { presets, TimeView, type PresetId } from './view.svelte';

	let {
		series,
		key,
		label,
		defaultPreset
	}: { series: Series[]; key: Key; label: string; defaultPreset: PresetId } = $props();

	// This chart's own time frame; zoom, pan and presets never affect the other chart.
	const view = untrack(() => new TimeView(`claude-usage:frame:${key}`, defaultPreset));
	$effect.pre(() => {
		const t = series[0].t;
		untrack(() => view.setDomain(t[0], t[t.length - 1]));
	});

	const when = (t: number) => `${fmtDate(t)}, ${fmtTime(t)}`;
	const range = $derived(
		view.preset === 'all'
			? `All data since ${fmtDate(view.d0)}`
			: view.t1 >= view.d1 - STEP
				? `${when(view.t0)} to now`
				: `${when(view.t0)} to ${when(view.t1)}`
	);

	const H = 200;
	const pad = { l: 34, r: 10, t: 10, b: 24 };
	const clipId = `clip-${key}`;

	// Only the width is measured. Height is fixed, so iOS toolbar show/hide
	// (which changes the viewport height while scrolling) never re-renders.
	let W = $state(350);
	let host: HTMLDivElement;
	let svg: SVGSVGElement;

	$effect(() => {
		const ro = new ResizeObserver(([e]) => {
			const w = Math.round(e.contentRect.width);
			if (w > 0 && w !== W) W = w;
		});
		ro.observe(host);
		return () => ro.disconnect();
	});

	const pw = $derived(W - pad.l - pad.r);
	const ph = H - pad.t - pad.b;
	const d0 = $derived(view.d0);
	const span = $derived(view.t1 - view.t0);
	const x = (t: number) => pad.l + ((t - view.t0) / span) * pw;
	const y = (v: number) => pad.t + (1 - v / 100) * ph;
	const timeAt = (px: number) => view.t0 + ((px - pad.l) / pw) * span;

	// Paths are built once per data load in data units (hours since d0, 0-100 %).
	// Zoom and pan only change the group transform; strokes keep their width
	// through vector-effect.
	const paths = $derived(
		series.map((s) => {
			const v = s[key];
			const n = v.length;
			let d = '';
			for (let i = 0; i < n; i++) {
				if (i > 0 && i < n - 1 && v[i] === v[i - 1] && v[i] === v[i + 1]) continue;
				d += `${d ? 'L' : 'M'}${((s.t[i] - s.t[0]) / HOUR).toFixed(3)} ${v[i].toFixed(1)}`;
			}
			return d;
		})
	);
	const transform = $derived.by(() => {
		const sx = (pw / span) * HOUR;
		const tx = pad.l - ((view.t0 - d0) / HOUR) * sx;
		return `matrix(${sx} 0 0 ${-ph / 100} ${tx} ${pad.t + ph})`;
	});

	// X ticks: the smallest step that leaves room for a label, aligned to local midnight.
	const steps = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 3 * DAY, 7 * DAY];
	const ticks = $derived.by(() => {
		const step = steps.find((s) => (s / span) * pw >= 62) ?? 7 * DAY;
		const m = new Date(d0);
		m.setHours(0, 0, 0, 0);
		const base = m.getTime();
		const out: { t: number; x: number; text: string }[] = [];
		const first = base + Math.ceil((view.t0 - base) / step) * step;
		for (let t = first; t <= view.t1; t += step) {
			const xx = x(t);
			if (xx < pad.l + 16 || xx > W - pad.r - 16) continue;
			const midnight = new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0;
			out.push({ t, x: xx, text: step < DAY && !midnight ? fmtTime(t) : fmtDate(t) });
		}
		return out;
	});

	const ends = $derived(
		series.map((s) => {
			const i = s.t.length - 1;
			return { color: s.color, t: s.t[i], v: s[key][i] };
		})
	);

	// Readout: tap (touch) or hover (mouse) shows the values at one time.
	let readout = $state<number | null>(null);
	const ro = $derived.by(() => {
		if (readout === null) return null;
		const s0 = series[0];
		const i = Math.max(0, Math.min(s0.t.length - 1, Math.round((readout - s0.t[0]) / STEP)));
		const t = s0.t[i];
		if (t < view.t0 || t > view.t1) return null;
		return {
			t,
			x: x(t),
			rows: series.map((s) => ({ color: s.color, name: s.email.split('@')[0], v: s[key][i] }))
		};
	});
	const tipLeft = $derived(ro ? Math.max(84, Math.min(W - 84, ro.x)) : 0);

	// Gestures: one finger dragging sideways pans, two fingers pinch-zoom around
	// their midpoint. The wrapper has touch-action: pan-y, so the browser keeps
	// every vertical drag for page scrolling; a one-finger drag is only claimed
	// once it is clearly horizontal, and a tap only counts if the finger stayed put.
	const pointers = new Map<number, { x: number; y: number }>();
	type Gesture =
		| { kind: 'pending'; x0: number; y0: number }
		| { kind: 'ignored' }
		| { kind: 'pan'; x0: number; a: number; b: number }
		| { kind: 'pinch'; d0: number; s0: number; tc: number };
	let gesture: Gesture | null = null;
	const CLAIM = 10; // px of travel before a drag counts as a gesture
	// Hover readouts only where a real hovering pointer exists; phones send
	// emulated mouse moves after taps that would otherwise move the readout.
	const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;

	function local(e: PointerEvent | WheelEvent) {
		const r = svg.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * W, y: e.clientY - r.top };
	}
	function startPinch() {
		const [p, q] = [...pointers.values()];
		const cx = (p.x + q.x) / 2;
		gesture = {
			kind: 'pinch',
			d0: Math.max(24, Math.hypot(p.x - q.x, p.y - q.y)),
			s0: span,
			tc: timeAt(cx)
		};
	}
	function startPan() {
		const [p] = [...pointers.values()];
		gesture = { kind: 'pan', x0: p.x, a: view.t0, b: view.t1 };
	}

	function down(e: PointerEvent) {
		if (e.pointerType === 'mouse') {
			if (e.button !== 0) return;
			svg.setPointerCapture(e.pointerId); // touch pointers are captured implicitly
		} else {
			// No focus (and no focus-scroll) or emulated mouse events from a touch.
			e.preventDefault();
		}
		const pt = local(e);
		pointers.set(e.pointerId, pt);
		if (pointers.size === 1) gesture = { kind: 'pending', x0: pt.x, y0: pt.y };
		else if (pointers.size === 2) {
			readout = null;
			startPinch();
		}
	}
	function move(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) {
			if (e.pointerType === 'mouse' && hover) readout = timeAt(local(e).x);
			return;
		}
		const pt = local(e);
		pointers.set(e.pointerId, pt);
		if (!gesture || gesture.kind === 'ignored') return;
		if (gesture.kind === 'pinch') {
			if (pointers.size < 2) return;
			const [p, q] = [...pointers.values()];
			const s = gesture.s0 * (gesture.d0 / Math.max(24, Math.hypot(p.x - q.x, p.y - q.y)));
			const t0 = gesture.tc - (((p.x + q.x) / 2 - pad.l) / pw) * s;
			view.set(t0, t0 + s);
		} else if (gesture.kind === 'pending') {
			const dx = Math.abs(pt.x - gesture.x0);
			const dy = Math.abs(pt.y - gesture.y0);
			if (dx >= CLAIM && dx > 2 * dy) {
				readout = null;
				startPan();
			} else if (dx >= CLAIM || dy >= CLAIM) {
				gesture = { kind: 'ignored' }; // vertical or diagonal: leave it to the page
			}
		} else {
			const shift = (-(pt.x - gesture.x0) / pw) * (gesture.b - gesture.a);
			view.set(gesture.a + shift, gesture.b + shift);
		}
	}
	function up(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		const p = local(e);
		pointers.delete(e.pointerId);
		if (gesture?.kind === 'pending' && pointers.size === 0) readout = timeAt(p.x);
		if (pointers.size === 1 && gesture?.kind === 'pinch') startPan();
		else if (pointers.size === 0) gesture = null;
	}
	function cancel(e: PointerEvent) {
		pointers.delete(e.pointerId);
		if (pointers.size === 0) gesture = null;
		else gesture = { kind: 'ignored' };
	}
	function leave(e: PointerEvent) {
		if (e.pointerType === 'mouse' && hover && !pointers.size) readout = null;
	}

	// Trackpad: pinch arrives as ctrl+wheel, sideways swipes as deltaX.
	// Plain vertical wheel is left alone so the page scrolls.
	function wheel(e: WheelEvent) {
		if (e.ctrlKey) {
			e.preventDefault();
			const tc = timeAt(local(e).x);
			const k = Math.exp(e.deltaY * 0.01);
			view.set(tc - (tc - view.t0) * k, tc + (view.t1 - tc) * k);
		} else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			e.preventDefault();
			const shift = (e.deltaX / pw) * span;
			view.set(view.t0 + shift, view.t1 + shift);
		}
	}

	function key_(e: KeyboardEvent) {
		const at = readout ?? view.t1;
		const by = e.shiftKey ? 12 * HOUR : HOUR;
		if (e.key === 'ArrowLeft') readout = Math.max(view.t0, at - by);
		else if (e.key === 'ArrowRight') readout = Math.min(view.t1, at + by);
		else if (e.key === '+' || e.key === '=') {
			const c = (view.t0 + view.t1) / 2;
			view.set(c - span / 4, c + span / 4);
		} else if (e.key === '-') {
			const c = (view.t0 + view.t1) / 2;
			view.set(c - span, c + span);
		} else if (e.key === 'Escape') readout = null;
		else return;
		e.preventDefault();
	}

	function outside(e: PointerEvent) {
		if (readout !== null && !host.contains(e.target as Node)) readout = null;
	}

	// Safari's own pinch gesture events: keep page zoom off the chart.
	$effect(() => {
		const stop = (e: Event) => e.preventDefault();
		svg.addEventListener('gesturestart', stop);
		svg.addEventListener('wheel', wheel, { passive: false });
		return () => {
			svg.removeEventListener('gesturestart', stop);
			svg.removeEventListener('wheel', wheel);
		};
	});
</script>

<svelte:window onpointerdown={outside} />

<div class="mt-2.5 inline-flex rounded-full border border-hair p-0.5" role="group" aria-label="{label} time frame">
	{#each presets as p (p.id)}
		<button
			type="button"
			class="h-7 cursor-pointer rounded-full px-2.5 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink {view.preset ===
			p.id
				? 'bg-white text-ink ring-1 ring-hair'
				: 'text-ink-2 active:bg-press'}"
			aria-pressed={view.preset === p.id}
			onclick={() => view.applyPreset(p.id)}
		>
			{p.label}
		</button>
	{/each}
</div>
<p class="mt-1.5 h-4 text-xs leading-4 whitespace-nowrap text-ink-2 tabular-nums" data-range>{range}</p>
<ul class="mt-3 mb-1.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-2">
	{#each series as a (a.email)}
		<li class="flex items-center gap-[7px]">
			<i class="h-[3px] w-4 rounded-sm" style:background={a.color}></i>{a.email}
		</li>
	{/each}
</ul>

<!-- Gestures live on this HTML wrapper: touch-action is honoured most reliably on HTML elements. -->
<div
	class="relative touch-pan-y select-none [-webkit-touch-callout:none]"
	style:height="{H}px"
	bind:this={host}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={cancel}
	onpointerleave={leave}
	role="presentation"
>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<svg
		bind:this={svg}
		class="block w-full overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink"
		style:height="{H}px"
		viewBox="0 0 {W} {H}"
		tabindex="0"
		role="img"
		aria-label="{label} usage per account, 0 to 100 percent. Pinch or drag sideways to zoom and pan; tap to read values."
		onkeydown={key_}
		onblur={() => (readout = null)}
	>
		<defs>
			<clipPath id={clipId}>
				<rect x={pad.l} y="0" width={pw} height={pad.t + ph + 2} />
			</clipPath>
		</defs>

		<g class="stroke-hair" shape-rendering="crispEdges">
			{#each [0, 25, 50, 75, 100] as v (v)}
				<line x1={pad.l} x2={W - pad.r} y1={Math.round(y(v)) + 0.5} y2={Math.round(y(v)) + 0.5} class={v === 0 ? 'stroke-axis' : ''} />
			{/each}
		</g>
		{#each [0, 25, 50, 75, 100] as v (v)}
			<text x={pad.l - 8} y={y(v) + 4} text-anchor="end" class="fill-muted text-[11px] tabular-nums">{v === 100 ? '100%' : v}</text>
		{/each}
		{#each ticks as tk (tk.t)}
			<line x1={Math.round(tk.x) + 0.5} x2={Math.round(tk.x) + 0.5} y1={y(0)} y2={y(0) + 4} class="stroke-axis" />
			<text x={tk.x} y={H - 6} text-anchor="middle" class="fill-muted text-[11px] tabular-nums">{tk.text}</text>
		{/each}

		<g clip-path="url(#{clipId})">
			<g {transform}>
				{#each paths as d, i (series[i].email)}
					<path
						{d}
						fill="none"
						stroke={series[i].color}
						stroke-width="1.75"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
				{/each}
			</g>
		</g>
		{#each ends as e (e.color)}
			{#if e.t >= view.t0 && e.t <= view.t1}
				<circle cx={x(e.t)} cy={y(e.v)} r="4" fill={e.color} class="stroke-page" stroke-width="2" />
			{/if}
		{/each}

		{#if ro}
			<line x1={ro.x} x2={ro.x} y1={pad.t} y2={y(0)} class="stroke-ink-2" stroke-width="1" />
			{#each ro.rows as r (r.color)}
				<circle cx={ro.x} cy={y(r.v)} r="4" fill={r.color} class="stroke-page" stroke-width="2" />
			{/each}
		{/if}
	</svg>

	{#if ro}
		<div
			class="pointer-events-none absolute -top-1.5 min-w-[150px] -translate-x-1/2 -translate-y-full rounded-lg border border-hair bg-white px-2.5 py-2 text-xs whitespace-nowrap shadow-[0_4px_14px_rgba(28,27,24,.08)]"
			style:left="{(tipLeft / W) * 100}%"
		>
			<div class="mb-1 text-muted">{fmtDay(ro.t)} {fmtDate(ro.t)}, {fmtTime(ro.t)}</div>
			{#each ro.rows as r (r.color)}
				<div class="flex items-center gap-[7px]">
					<i class="h-[3px] w-4 rounded-sm" style:background={r.color}></i>
					<b class="min-w-[34px] font-semibold tabular-nums">{Math.round(r.v)}%</b>
					<span class="text-ink-2">{r.name}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
