<script lang="ts">
	import Chart from '../lib/Chart.svelte';
	import { load, type Series } from '../lib/data';
	import { fmtAgo, fmtDay, fmtIn, fmtTime } from '../lib/format';

	let data = $state.raw<Series[]>(load());
	let loadedAt = $state(Date.now());
	let now = $state(Date.now());
	let busy = $state(false);

	// Restarted on every refresh so the label ticks on whole seconds since then.
	$effect(() => {
		const from = loadedAt;
		const id = setInterval(() => (now = Math.max(Date.now(), from)), 1000);
		return () => clearInterval(id);
	});

	// Stand-in for refetching /usage and /history.
	function refresh() {
		if (busy) return;
		busy = true;
		setTimeout(() => {
			data = load();
			loadedAt = now = Date.now();
			busy = false;
		}, 700);
	}

	const windows = $derived(
		data.map((a) => {
			const i = a.t.length - 1;
			return {
				...a,
				rows: [
					{ name: '5-hour', pct: a.h5[i], at: a.fiveEnd, when: fmtTime(a.fiveEnd) },
					{ name: 'Weekly', pct: a.wk[i], at: a.weekEnd, when: `${fmtDay(a.weekEnd)} ${fmtTime(a.weekEnd)}` }
				]
			};
		})
	);
</script>

<main
	class="mx-auto max-w-[480px] px-5 pt-5 pb-8"
>
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="m-0 font-serif text-[30px] leading-[1.1] font-normal tracking-[-0.01em]">Claude usage</h1>
			<!-- Fixed box: the ticking text can never reflow anything. -->
			<p class="mt-1.5 h-[19px] w-40 overflow-hidden text-[13px] leading-[19px] whitespace-nowrap text-muted tabular-nums">
				{fmtAgo(now - loadedAt)}
			</p>
		</div>
		<button
			type="button"
			class="inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-full border border-hair bg-white pr-[15px] pl-3 text-sm leading-none font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ink active:bg-press"
			aria-busy={busy}
			onclick={refresh}
		>
			<svg
				viewBox="0 0 16 16"
				class="size-4 {busy ? 'animate-[spin_.7s_linear_infinite] motion-reduce:animate-none' : ''}"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" /><path d="M13.5 2.5v3h-3" />
			</svg>
			Refresh
		</button>
	</header>

	<section class="mt-7 border-t border-hair" aria-label="Accounts">
		{#each windows as a (a.email)}
			<article class="border-b border-hair pt-[18px] pb-5">
				<h3 class="mb-3.5 flex min-w-0 items-center gap-2.5 text-sm font-medium">
					<i class="h-[3px] w-4 flex-none rounded-sm" style:background={a.color}></i>
					<span class="truncate">{a.email}</span>
				</h3>
				<div class="grid grid-cols-2 gap-5">
					{#each a.rows as w (w.name)}
						<div>
							<p class="text-[13px] text-ink-2">{w.name}</p>
							<p class="mt-0.5 mb-2.5 text-[40px] leading-none font-semibold tracking-[-0.03em]">
								{Math.round(w.pct)}<small class="ml-px text-xl font-medium tracking-normal text-ink-2">%</small>
							</p>
							<div
								class="h-1 overflow-hidden rounded-sm"
								style:background={a.track}
								role="img"
								aria-label="{Math.round(w.pct)} percent used"
							>
								<i class="block h-full rounded-sm" style:background={a.color} style:width="{Math.min(100, w.pct)}%"></i>
							</div>
							<p class="mt-[9px] text-[13px] leading-[1.35] text-ink-2">
								Resets <b class="font-medium text-ink">{w.when}</b><br />{fmtIn(w.at - a.t[a.t.length - 1])}
							</p>
						</div>
					{/each}
				</div>
			</article>
		{/each}
	</section>

	{#each [{ key: 'h5', title: '5-hour window', preset: '1d' }, { key: 'wk', title: 'Weekly window', preset: '1w' }] as const as c (c.key)}
		<section class="mt-9" aria-label={c.title}>
			<h2 class="font-serif text-[21px] leading-[1.2] font-normal">{c.title}</h2>
			<div class="transition-opacity duration-200 motion-reduce:transition-none {busy ? 'opacity-45' : ''}">
				<Chart series={data} key={c.key} label={c.title} defaultPreset={c.preset} />
			</div>
		</section>
	{/each}

	<footer class="mt-9 text-xs text-muted">Pinch or drag a chart sideways to zoom and pan. Mockup with made-up numbers.</footer>
</main>
