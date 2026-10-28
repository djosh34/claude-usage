<script lang="ts">
	import Chart from '../lib/Chart.svelte';
	import { load, type Data } from '../lib/data';
	import { fmtAgo, fmtDay, fmtIn, fmtTime } from '../lib/format';

	let data = $state.raw<Data>({ accounts: [], series: [], fetchedAt: 0 });
	let loadedAt = $state(Date.now());
	let now = $state(Date.now());
	let busy = $state(false);
	let failed = $state<string | null>(null);

	// Restarted on every refresh so the label ticks on whole seconds since then.
	$effect(() => {
		const from = loadedAt;
		const id = setInterval(() => (now = Math.max(Date.now(), from)), 1000);
		return () => clearInterval(id);
	});

	// Fetches /api/usage and /api/history. Only the button and the first load call it.
	async function refresh() {
		if (busy) return;
		busy = true;
		try {
			data = await load();
			loadedAt = now = data.fetchedAt;
			failed = null;
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	refresh();

	const windows = $derived(
		data.accounts.map((a) => ({
			...a,
			rows: [
				{ name: '5-hour', w: a.live.h5, when: (t: number) => fmtTime(t) },
				{ name: 'Weekly', w: a.live.wk, when: (t: number) => `${fmtDay(t)} ${fmtTime(t)}` }
			]
		}))
	);
	// The charts need at least two points in time to draw.
	const charted = $derived(data.series.length > 0 && data.series[0].t.length > 1);
</script>

<main
	class="mx-auto max-w-[480px] px-5 pt-5 pb-8"
>
	<header class="flex items-start justify-between gap-4">
		<div>
			<h1 class="m-0 font-serif text-[30px] leading-[1.1] font-normal tracking-[-0.01em]">Claude usage</h1>
			<!-- Fixed box: the ticking text can never reflow anything. -->
			<p class="mt-1.5 h-[19px] w-40 overflow-hidden text-[13px] leading-[19px] whitespace-nowrap text-muted tabular-nums">
				{data.fetchedAt ? fmtAgo(now - loadedAt) : busy ? 'Loading' : 'Not loaded'}
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

	{#if failed}
		<p class="mt-4 text-[13px] leading-[1.35] text-ink-2" role="alert">
			Could not load usage: {failed}.
		</p>
	{/if}

	<section class="mt-7 border-t border-hair" aria-label="Accounts">
		{#each windows as a (a.id)}
			<article class="border-b border-hair pt-[18px] pb-5">
				<h3 class="mb-3.5 flex min-w-0 items-center gap-2.5 text-sm font-medium {a.error ? 'text-muted' : ''}">
					<i class="h-[3px] w-4 flex-none rounded-sm" style:background={a.error ? 'var(--color-axis)' : a.color}></i>
					<span class="truncate">{a.email}</span>
				</h3>
				{#if a.error}
					<p class="text-[13px] leading-[1.35] text-muted">Usage unavailable: {a.error}</p>
				{:else}
					<div class="grid grid-cols-2 gap-5">
						{#each a.rows as r (r.name)}
							<div>
								<p class="text-[13px] text-ink-2">{r.name}</p>
								{#if r.w}
									<p class="mt-0.5 mb-2.5 text-[40px] leading-none font-semibold tracking-[-0.03em]">
										{Math.round(r.w.pct)}<small class="ml-px text-xl font-medium tracking-normal text-ink-2">%</small>
									</p>
									<div
										class="h-1 overflow-hidden rounded-sm"
										style:background={a.track}
										role="img"
										aria-label="{Math.round(r.w.pct)} percent used"
									>
										<i class="block h-full rounded-sm" style:background={a.color} style:width="{Math.min(100, r.w.pct)}%"></i>
									</div>
									<p class="mt-[9px] text-[13px] leading-[1.35] text-ink-2">
										{#if r.w.at === null}
											Reset time unknown
										{:else}
											Resets <b class="font-medium text-ink">{r.when(r.w.at)}</b><br />{fmtIn(r.w.at - data.fetchedAt)}
										{/if}
									</p>
								{:else}
									<p class="mt-0.5 mb-2.5 text-[40px] leading-none font-semibold tracking-[-0.03em] text-muted">–</p>
									<div class="h-1 rounded-sm bg-hair"></div>
									<p class="mt-[9px] text-[13px] leading-[1.35] text-muted">No data</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</article>
		{/each}
	</section>

	{#each [{ key: 'h5', title: '5-hour window', preset: '1d' }, { key: 'wk', title: 'Weekly window', preset: '1w' }] as const as c (c.key)}
		<section class="mt-9" aria-label={c.title}>
			<h2 class="font-serif text-[21px] leading-[1.2] font-normal">{c.title}</h2>
			{#if charted}
				<div class="transition-opacity duration-200 motion-reduce:transition-none {busy ? 'opacity-45' : ''}">
					<Chart series={data.series} key={c.key} label={c.title} defaultPreset={c.preset} />
				</div>
			{:else if data.fetchedAt}
				<p class="mt-2.5 text-[13px] leading-[1.35] text-muted">No data</p>
			{/if}
		</section>
	{/each}

	<footer class="mt-9 text-xs text-muted">Pinch or drag a chart sideways to zoom and pan.</footer>
</main>
