// ECharts option builders. Colours, grids, tooltips and series styling mirror
// the reference UI. The one deliberate omission: the reference main chart's
// shaded 90% range band, which needs forecast-spread data the API does not
// provide — drawing it from run spread would mislabel it, so it is left out
// (see README).

import type { Run } from './api';
import { fmt } from './format';

export interface ThemeColors {
  actual: string;
  forecast: string;
  old1: string;
  old2: string;
  grid: string;
  axis: string;
  tipBg: string;
  tipText: string;
  neg: string;
}

export function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        actual: '#F4F4F5',
        forecast: '#10B981',
        old1: '#71717A',
        old2: '#52525B',
        grid: 'rgba(255,255,255,0.08)',
        axis: '#A1A1AA',
        tipBg: '#18181B',
        tipText: '#F4F4F5',
        neg: '#F43F5E',
      }
    : {
        actual: '#18181B',
        forecast: '#059669',
        old1: '#A1A1AA',
        old2: '#D4D4D8',
        grid: '#F4F4F5',
        axis: '#52525B',
        tipBg: '#18181B',
        tipText: '#FFFFFF',
        neg: '#E11D48',
      };
}

function tip(C: ThemeColors, extra?: Record<string, unknown>) {
  return {
    trigger: 'axis',
    backgroundColor: C.tipBg,
    borderWidth: 0,
    textStyle: { color: C.tipText },
    ...(extra || {}),
  };
}

function axisLabel(C: ThemeColors) {
  return { color: C.axis };
}

/** Main chart: actual + the latest 3 runs (latest solid, older dashed/dotted). */
export function mainOption(
  C: ThemeColors,
  labels: string[],
  actual: number[],
  runs: Run[], // chronological; the last element is the latest run
) {
  const last3 = runs.slice(-3);
  const latest = last3[last3.length - 1];
  const older = last3.slice(0, -1); // chronological, oldest first
  const series: Record<string, unknown>[] = [
    {
      name: 'Actual',
      type: 'line',
      data: actual,
      lineStyle: { color: C.actual, width: 2.5 },
      itemStyle: { color: C.actual },
      symbol: 'none',
      areaStyle: { opacity: 0.06, color: C.actual },
    },
  ];
  if (latest) {
    series.push({
      name: latest.label,
      type: 'line',
      data: latest.values,
      lineStyle: { color: C.forecast, width: 2.5 },
      itemStyle: { color: C.forecast },
      symbol: 'none',
    });
  }
  // Older runs, newest-first, so the legend reads latest -> oldest like the file.
  const olderStyles = [
    { color: C.old1, type: 'dashed' },
    { color: C.old2, type: 'dotted' },
  ];
  [...older].reverse().forEach((run, i) => {
    const st = olderStyles[i] || { color: C.old2, type: 'dotted' };
    series.push({
      name: run.label,
      type: 'line',
      data: run.values,
      lineStyle: { color: st.color, width: 1.5, type: st.type },
      itemStyle: { color: st.color },
      symbol: 'none',
    });
  });
  return {
    tooltip: tip(C, {
      formatter: (ps: { dataIndex: number; marker: string; seriesName: string; value: number }[]) => {
        const i = ps[0].dataIndex;
        let s = '<b>' + labels[i] + ' UTC</b>';
        ps.forEach((p) => {
          s += '<br>' + p.marker + p.seriesName + ': ' + fmt(p.value) + ' MW';
        });
        return s;
      },
    }),
    legend: {
      data: series.map((s) => s.name as string),
      textStyle: { color: C.axis },
    },
    grid: { left: 64, right: 24, top: 36, bottom: 30 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { interval: 3, color: C.axis },
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      name: 'MW',
      axisLabel: { color: C.axis, formatter: (v: number) => v / 1000 + 'k' },
      splitLine: { lineStyle: { color: C.grid } },
    },
    series,
  };
}

/** Signed error bars: error = actual − forecast; negative = shortfall. */
export function errorOption(C: ThemeColors, labels: string[], errors: number[]) {
  return {
    tooltip: tip(C, { valueFormatter: (v: number) => fmt(v) + ' MW' }),
    grid: { left: 64, right: 24, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { interval: 3, color: C.axis },
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      name: 'MW',
      axisLabel: axisLabel(C),
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'bar',
        data: errors,
        itemStyle: {
          color: (p: { value: number }) => (p.value < 0 ? C.neg : C.forecast),
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: C.actual },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

/** Revision chart: every run's total energy vs the actual line. */
export function revOption(
  C: ThemeColors,
  runLabels: string[],
  totals: number[],
  actualTotal: number,
) {
  return {
    tooltip: tip(C, { valueFormatter: (v: number) => v.toFixed(1) + ' GWh' }),
    grid: { left: 56, right: 24, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: runLabels,
      axisLabel: { color: C.axis },
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      name: 'GWh',
      axisLabel: axisLabel(C),
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'line',
        data: totals,
        lineStyle: { color: C.forecast, width: 2.5 },
        itemStyle: { color: C.forecast },
        symbolSize: 9,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: C.actual, type: 'dashed' },
          label: { formatter: 'Actual ' + actualTotal.toFixed(1) + ' GWh', color: C.axis },
          data: [{ yAxis: actualTotal }],
        },
      },
    ],
  };
}

/** January daily-MAE bars; the selected day is highlighted. */
export function monthOption(
  C: ThemeColors,
  dayLabels: string[],
  maes: number[],
  selectedIndex: number,
) {
  return {
    tooltip: tip(C, { valueFormatter: (v: number) => fmt(v) + ' MW' }),
    grid: { left: 64, right: 24, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: dayLabels,
      axisLabel: { interval: 0, rotate: 45, fontSize: 11, color: C.axis },
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      name: 'MAE (MW)',
      axisLabel: axisLabel(C),
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'bar',
        data: maes,
        itemStyle: {
          color: (p: { dataIndex: number }) => (p.dataIndex === selectedIndex ? C.forecast : C.old1),
        },
      },
    ],
  };
}

export const AGES = [4, 8, 12, 24, 36, 48];

export function nearestAge(h: number): number {
  let best = 0;
  AGES.forEach((a, i) => {
    if (Math.abs(a - h) < Math.abs(AGES[best] - h)) best = i;
  });
  return best;
}

/** Average miss by forecast-age bucket across January (null = no runs at that age). */
export function ageOption(
  C: ThemeColors,
  bucketMae: (number | null)[],
  highlightIndex: number,
) {
  return {
    tooltip: tip(C, { valueFormatter: (v: number) => fmt(v) + ' MW' }),
    grid: { left: 48, right: 12, top: 24, bottom: 26 },
    xAxis: {
      type: 'category',
      data: AGES.map((h) => h + 'h'),
      axisLabel: axisLabel(C),
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: axisLabel(C),
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'bar',
        data: bucketMae.map((v) => (v === null ? null : Math.round(v))),
        label: { show: true, position: 'top', color: C.axis, fontSize: 11 },
        itemStyle: {
          color: (p: { dataIndex: number }) =>
            p.dataIndex === highlightIndex ? C.forecast : C.old1,
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  };
}

/** Histogram of forecast minus actual across January (latest run), 400 MW bins. */
export function histOption(C: ThemeColors, counts: number[]) {
  return {
    tooltip: tip(C, { valueFormatter: (v: number) => v + ' half-hours' }),
    grid: { left: 40, right: 12, top: 16, bottom: 40 },
    xAxis: {
      type: 'category',
      name: 'GW',
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { color: C.axis },
      data: counts.map((_, i) => ((i * 400 - 3000 + 200) / 1000).toFixed(1)),
      axisLabel: { color: C.axis, interval: 1 },
      axisLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: axisLabel(C),
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'bar',
        data: counts,
        barCategoryGap: '8%',
        itemStyle: {
          color: (p: { dataIndex: number }) =>
            p.dataIndex < 7 ? C.forecast : p.dataIndex > 7 ? C.neg : C.old1,
        },
      },
    ],
  };
}
