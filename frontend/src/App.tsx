import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  fetchConfig,
  fetchDay,
  fetchHealth,
  fetchMonth,
  type Config,
  type DayData,
  type Health,
  type MonthSummary,
  type Run,
} from './lib/api';
import {
  clamp,
  computeRunMetrics,
  dayLabel,
  decisionDayLabel,
  dow,
  dowName,
  fmt,
  gw,
  monthLabel,
  parseDay,
  positionFor,
  publishedLabel,
  runAgeHours,
} from './lib/format';
import {
  AGES,
  ageOption,
  errorOption,
  histOption,
  mainOption,
  monthOption,
  nearestAge,
  revOption,
  themeColors,
} from './lib/charts';
import { startBackground, startIntro, type IntroHandle } from './lib/globe';

/* ---------- Count-up numbers (as in the reference UI) ---------- */
const prevKPI: Record<string, number> = {};
function countUp(el: HTMLElement | null, id: string, to: number, decimals: number, suffix: string) {
  const target = el;
  if (!target) return;
  const from = prevKPI[id] || 0;
  prevKPI[id] = to;
  const start = performance.now();
  const dur = 750;
  function step(ts: number) {
    const p = Math.min(1, (ts - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = from + (to - from) * e;
    target!.textContent = (decimals ? v.toFixed(decimals) : fmt(v)) + (suffix || '');
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

const MOON_SVG = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />
  </svg>
);
const SUN_SVG = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      strokeLinecap="round"
    />
  </svg>
);

interface JanExtra {
  age: (number | null)[];
  hist: number[];
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [introVisible, setIntroVisible] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [month, setMonth] = useState<MonthSummary | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  const [dayAttempt, setDayAttempt] = useState(0);
  const [hz, setHz] = useState(24);
  const [shortOnly, setShortOnly] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSec, setActiveSec] = useState('top');
  const [countdown, setCountdown] = useState('--:--:--');
  const [janExtra, setJanExtra] = useState<JanExtra | null>(null);
  const [janExtraError, setJanExtraError] = useState(false);

  const themeRef = useRef(theme);
  themeRef.current = theme;
  const hzTouchedRef = useRef(false);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const introRef = useRef<HTMLDivElement | null>(null);
  const gRef = useRef<HTMLCanvasElement | null>(null);
  const capRef = useRef<HTMLDivElement | null>(null);
  const skipRef = useRef<HTMLButtonElement | null>(null);
  const kpiEls = useRef<Record<string, HTMLElement | null>>({});
  const chartDivs = useRef<Record<string, HTMLDivElement | null>>({});
  const chartInst = useRef<Record<string, echarts.ECharts | undefined>>({});
  const monthBoundInst = useRef<echarts.ECharts | null>(null);
  const monthDaysRef = useRef<MonthSummary['days']>([]);

  const dark = theme === 'dark';
  const monthDays = month?.days ?? [];
  monthDaysRef.current = monthDays;
  const selectedIndex = monthDays.findIndex((d) => d.date === selectedDate);
  const monthName = month ? monthLabel(month.month).split(' ')[0] : 'January';

  /* ---------- Focus run: nearest by forecast age to the slider value ----------
     The reference UI's slider drove age-curve statistics the API does not
     provide, so it selects the run whose age at delivery start is closest to
     the slider value. Default = the latest run's age, so the default view
     matches the reference UI (latest run everywhere). */
  const focusRun: Run | null = useMemo(() => {
    if (!day || day.runs.length === 0) return null;
    const ages = day.runs.map((r) => runAgeHours(r.published, day.date));
    if (ages.every((a) => a === null)) return day.runs[day.runs.length - 1];
    let best = 0;
    let bestDiff = Infinity;
    day.runs.forEach((_, i) => {
      const a = ages[i];
      if (a === null) return;
      const diff = Math.abs(a - hz);
      if (diff < bestDiff || (diff === bestDiff && i > best)) {
        bestDiff = diff;
        best = i;
      }
    });
    return day.runs[best];
  }, [day, hz]);
  const focusIsLatest =
    !!day && !!focusRun && focusRun === day.runs[day.runs.length - 1];

  /* KPIs: the API's per-day KPIs when the focus run is the latest run,
     otherwise recomputed exactly from the focus run's 48 values. */
  const kpis = useMemo(() => {
    if (!day || !focusRun) return null;
    if (focusIsLatest) return day.kpis;
    const m = computeRunMetrics(focusRun.values, day.actual);
    return {
      forecast_gwh: m.total,
      actual_gwh: day.actual.reduce((a, b) => a + b, 0) / 2 / 1000,
      mae_mw: m.mae,
      bias_mw: m.bias,
      rmse_mw: m.rmse,
      largest_shortfall_mw: m.largestShortfall,
      largest_shortfall_time: day.times[m.largestShortfallH] ?? '',
    };
  }, [day, focusRun, focusIsLatest]);

  const errors = useMemo(() => {
    if (!day || !focusRun) return [];
    return day.actual.map((a, h) => a - focusRun.values[h]);
  }, [day, focusRun]);

  const tableRows = useMemo(() => {
    if (!day || !focusRun) return [];
    if (focusIsLatest) return day.table;
    return day.times.map((t, h) => {
      const e = day.actual[h] - focusRun.values[h];
      return {
        time: t,
        forecast: focusRun.values[h],
        actual: day.actual[h],
        error: e,
        position: positionFor(e),
      };
    });
  }, [day, focusRun, focusIsLatest]);

  const shownRows = shortOnly
    ? tableRows.filter((r) => r.position === 'Shortfall')
    : tableRows;

  const avgF = useMemo(
    () => (focusRun ? focusRun.values.reduce((a, b) => a + b, 0) / 48 : 0),
    [focusRun],
  );
  const peak = useMemo(() => {
    if (!focusRun) return { v: 0, i: 0 };
    let v = -Infinity;
    let i = 0;
    focusRun.values.forEach((x, h) => {
      if (x > v) {
        v = x;
        i = h;
      }
    });
    return { v, i };
  }, [focusRun]);

  const janMeanMae = useMemo(
    () =>
      monthDays.length
        ? monthDays.reduce((a, d) => a + d.mae_mw, 0) / monthDays.length
        : null,
    [monthDays],
  );
  const janMeanBias = useMemo(
    () =>
      monthDays.length
        ? monthDays.reduce((a, d) => a + d.bias_mw, 0) / monthDays.length
        : null,
    [monthDays],
  );
  const maxMaeDay = useMemo(() => {
    if (!monthDays.length) return null;
    return monthDays.reduce((a, d) => (d.mae_mw > a.mae_mw ? d : a), monthDays[0]);
  }, [monthDays]);

  const sourceWord = health
    ? health.source === 'live'
      ? 'Live data'
      : 'Stored snapshot'
    : 'Connecting…';
  const sourcePill = health
    ? health.source === 'live'
      ? 'Live Elexon data · January 2026'
      : 'Elexon snapshot · January 2026'
    : 'Connecting to the WindDesk API…';
  const sourceSentence = health
    ? health.source === 'live'
      ? 'Figures are served live from Elexon BMRS via the WindDesk API.'
      : 'Figures come from a stored Elexon snapshot in the same shape as the live feed.'
    : 'Figures load from the WindDesk API when it is reachable.';
  const tickerTail = health
    ? health.source === 'live'
      ? 'Live — figures from Elexon BMRS via the WindDesk API'
      : 'Snapshot — figures from the stored Elexon snapshot'
    : 'Connecting to the WindDesk API…';

  /* ---------- Theme ---------- */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // Redraw the background map in the new theme (its resize hook re-renders it).
    window.dispatchEvent(new Event('resize'));
  }, [theme]);

  /* ---------- Intro globe + background map (mount once) ---------- */
  useEffect(() => {
    if (!bgRef.current) return;
    const stopBg = startBackground(bgRef.current, () => themeRef.current === 'dark');
    let intro: IntroHandle | null = null;
    if (introRef.current && gRef.current && capRef.current && skipRef.current) {
      intro = startIntro({
        intro: introRef.current,
        canvas: gRef.current,
        cap: capRef.current,
        skipBtn: skipRef.current,
        isDark: () => themeRef.current === 'dark',
        onDone: () => setIntroVisible(false),
      });
    } else {
      document.body.classList.add('on');
    }
    return () => {
      stopBg();
      intro?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Header pill + scroll-spy ---------- */
  useEffect(() => {
    const onScroll = () => {
      document.body.classList.toggle('scrolled', window.scrollY > 50);
      let cur = 'top';
      ['top', 'forecast', 'accuracy', 'detail'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top + window.scrollY - 180 <= window.scrollY)
          cur = id;
      });
      setActiveSec(cur);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* ---------- Scroll reveal ---------- */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            obs.unobserve(en.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    document.querySelectorAll('.reveal:not(.in)').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [month, bootError]);

  /* ---------- Bootstrap: health + config + month, then the worst-MAE day ---------- */
  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    Promise.all([fetchHealth(), fetchConfig(), fetchMonth()])
      .then(([h, c, m]) => {
        if (cancelled) return;
        setHealth(h);
        setConfig(c);
        setMonth(m);
        if (m.days.length) {
          const worst = m.days.reduce((a, d) => (d.mae_mw > a.mae_mw ? d : a), m.days[0]);
          setSelectedDate(worst.date);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setBootError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  /* ---------- Day load ---------- */
  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    setDayLoading(true);
    setDayError(null);
    fetchDay(selectedDate)
      .then((d) => {
        if (cancelled) return;
        setDay(d);
        setDayLoading(false);
        if (!hzTouchedRef.current && d.runs.length) {
          const latest = d.runs[d.runs.length - 1];
          const age = runAgeHours(latest.published, d.date);
          if (age !== null) setHz(clamp(Math.round(age), 4, 48));
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setDayLoading(false);
        setDayError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, dayAttempt]);

  /* ---------- January extras: age curve + error histogram from all day payloads ----------
     Computed in the background from real API data. If it fails, those two
     panels show an honest note instead of invented numbers. */
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    setJanExtra(null);
    setJanExtraError(false);
    Promise.all(month.days.map((d) => fetchDay(d.date)))
      .then((payloads) => {
        if (cancelled) return;
        const ageSum = new Array(AGES.length).fill(0);
        const ageCount = new Array(AGES.length).fill(0);
        const hist = new Array(15).fill(0);
        payloads.forEach((p) => {
          p.runs.forEach((run) => {
            const age = runAgeHours(run.published, p.date);
            if (age !== null) {
              const b = nearestAge(age);
              ageSum[b] += computeRunMetrics(run.values, p.actual).mae;
              ageCount[b] += 1;
            }
          });
          const latest = p.runs[p.runs.length - 1];
          if (latest) {
            latest.values.forEach((f, h) => {
              const e = f - p.actual[h]; // forecast minus actual, as in the file
              hist[clamp(Math.floor((e + 3000) / 400), 0, 14)] += 1;
            });
          }
        });
        setJanExtra({
          age: ageSum.map((s, i) => (ageCount[i] ? s / ageCount[i] : null)),
          hist,
        });
      })
      .catch(() => {
        if (!cancelled) setJanExtraError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  /* ---------- Countdown to the next cutoff ---------- */
  useEffect(() => {
    if (!config) return;
    const m = /^(\d{1,2}):(\d{2})/.exec(config.cutoff);
    if (!m) {
      setCountdown('--:--:--');
      return;
    }
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const tick = () => {
      const n = new Date();
      const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), hh, mm));
      if (t < n) t.setUTCDate(t.getUTCDate() + 1);
      const s = Math.floor((t.getTime() - n.getTime()) / 1000);
      setCountdown(
        [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
          .map((v) => String(v).padStart(2, '0'))
          .join(':'),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [config]);

  /* ---------- Charts ---------- */
  useEffect(() => {
    if (!month || bootError || !day) return;
    const C = themeColors(dark);
    const get = (key: string, divKey: string) => {
      const div = chartDivs.current[divKey];
      if (!div) return null;
      const existing = chartInst.current[key];
      // Re-init if the div was remounted (e.g. an error panel replaced it).
      if (existing && existing.getDom() !== div) {
        existing.dispose();
        chartInst.current[key] = undefined;
      }
      if (!chartInst.current[key]) chartInst.current[key] = echarts.init(div);
      return chartInst.current[key];
    };
    const loadingStyle = {
      text: 'Loading…',
      color: '#10B981',
      textColor: '#A1A1AA',
      maskColor: 'rgba(0,0,0,0)',
    };
    const mc = get('main', 'mainChart');
    if (mc) {
      if (dayLoading) mc.showLoading('default', loadingStyle);
      else {
        mc.hideLoading();
        mc.setOption(mainOption(C, day.times.map((t) => t.slice(0, 5)), day.actual, day.runs));
      }
    }
    const ec = get('error', 'errorChart');
    if (ec) {
      if (dayLoading) ec.showLoading('default', loadingStyle);
      else {
        ec.hideLoading();
        ec.setOption(errorOption(C, day.times.map((t) => t.slice(0, 5)), errors));
      }
    }
    const rc = get('rev', 'revChart');
    if (rc) {
      if (dayLoading) rc.showLoading('default', loadingStyle);
      else {
        rc.hideLoading();
        rc.setOption(
          revOption(
            C,
            day.runs.map((r) => r.label),
            day.runs.map((r) => r.total_gwh),
            kpis ? kpis.actual_gwh : 0,
          ),
        );
      }
    }
    const moc = get('month', 'monthChart');
    if (moc) {
      moc.hideLoading();
      moc.setOption(
        monthOption(
          C,
          monthDays.map((d) => `${parseDay(d.date).getUTCDate()} Jan`),
          monthDays.map((d) => Math.round(d.mae_mw)),
          selectedIndex,
        ),
      );
      if (monthBoundInst.current !== moc) {
        monthBoundInst.current = moc;
        moc.on('click', (p: { dataIndex: number }) => {
          const d = monthDaysRef.current[p.dataIndex];
          if (d) {
            setSelectedDate(d.date);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      }
    }
    const ac = get('age', 'ageChart');
    if (ac) {
      if (janExtra) {
        ac.hideLoading();
        ac.setOption(ageOption(C, janExtra.age, nearestAge(hz)));
      } else if (!janExtraError) {
        ac.showLoading('default', {
          ...loadingStyle,
          text: 'Computing January age curve…',
        });
      }
    }
    const hc = get('hist', 'histChart');
    if (hc) {
      if (janExtra) {
        hc.hideLoading();
        hc.setOption(histOption(C, janExtra.hist));
      } else if (!janExtraError) {
        hc.showLoading('default', {
          ...loadingStyle,
          text: 'Computing January distribution…',
        });
      }
    }
  }, [
    month,
    bootError,
    day,
    dayLoading,
    dark,
    selectedIndex,
    monthDays,
    errors,
    kpis,
    janExtra,
    janExtraError,
    hz,
  ]);

  /* ---------- Chart resize ---------- */
  useEffect(() => {
    const onResize = () => Object.values(chartInst.current).forEach((c) => c?.resize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---------- Count-up KPIs ---------- */
  useEffect(() => {
    if (!day || !focusRun || !kpis) return;
    const el = (id: string) => kpiEls.current[id] ?? null;
    countUp(el('kpiForecast'), 'kpiForecast', kpis.forecast_gwh, 1, ' GWh');
    countUp(el('kpiActual'), 'kpiActual', kpis.actual_gwh, 1, ' GWh');
    countUp(el('kpiMae'), 'kpiMae', kpis.mae_mw, 0, ' MW');
    countUp(el('kpiShort'), 'kpiShort', kpis.largest_shortfall_mw, 0, ' MW');
    countUp(el('kpiAvg'), 'kpiAvg', avgF / 1000, 1, ' GW');
    if (janMeanMae !== null) countUp(el('kpiMiss'), 'kpiMiss', janMeanMae, 0, ' MW');
    const buy = el('kpiBuy');
    if (buy) buy.textContent = '–';
    const buf = el('kpiBuf');
    if (buf) buf.textContent = '–';
  }, [day, focusRun, kpis, avgF, janMeanMae]);

  const toggleTheme = () => setTheme(dark ? 'light' : 'dark');
  const setDayIndex = (idx: number) => {
    const d = monthDays[clamp(idx, 0, monthDays.length - 1)];
    if (d) setSelectedDate(d.date);
  };
  const kpiRef = (id: string) => (el: HTMLElement | null) => {
    kpiEls.current[id] = el;
  };
  const chartRef = (key: string) => (el: HTMLDivElement | null) => {
    chartDivs.current[key] = el;
  };

  const dayNum = day ? parseDay(day.date).getUTCDate() : 0;
  const mainNote = day
    ? maxMaeDay && day.date === maxMaeDay.date
      ? `This is the month's highest-MAE day (${fmt(maxMaeDay.mae_mw)} MW) — the largest gap between forecast and actuals in January, and the procurement risk the desk carried.`
      : 'Forecast runs mostly track actuals on this day; the gap between the latest run and actuals is the procurement risk the desk carried.'
    : '';
  const focusAge =
    day && focusRun ? runAgeHours(focusRun.published, day.date) : null;

  /* ---------- Calendar colours (reference UI's emerald -> rose ramp) ---------- */
  const calMaes = monthDays.map((d) => d.mae_mw);
  const calMn = calMaes.length ? Math.min(...calMaes) : 0;
  const calMx = calMaes.length ? Math.max(...calMaes) : 0;
  const calColor = (v: number) => {
    const u = (v - calMn) / (calMx - calMn || 1);
    const r = Math.round(16 + (244 - 16) * u);
    const g = Math.round(185 + (63 - 185) * u);
    const b = Math.round(129 + (94 - 129) * u);
    return `rgb(${r},${g},${b})`;
  };
  const firstDow = month ? dow(`${month.month}-01`) : 0;

  const dashReady = !!month && !bootError;

  return (
    <>
      <canvas id="bg" ref={bgRef}></canvas>

      {introVisible && (
        <div id="intro" ref={introRef}>
          <canvas id="g" ref={gRef}></canvas>
          <div id="cap" ref={capRef}>
            Connecting to Elexon BMRS
          </div>
          <button id="skip" ref={skipRef} type="button">
            Skip intro
          </button>
        </div>
      )}

      <header>
        <div className="bar" id="headerBar">
          <a className="wordmark" href="#top">
            Wind<span>Desk</span>
          </a>
          <nav className="center-links">
            <a href="#top">Overview</a>
            <a href="#forecast">Forecast</a>
            <a href="#accuracy">Accuracy</a>
            <a href="#detail">Detail</a>
          </nav>
          <div className="header-right">
            <button
              className="icon-btn"
              id="themeBtn"
              type="button"
              aria-label="Toggle theme"
              onClick={toggleTheme}
            >
              <svg
                id="themeIconMoon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ display: dark ? 'none' : 'block' }}
              >
                <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />
              </svg>
              <svg
                id="themeIconSun"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ display: dark ? 'block' : 'none' }}
              >
                <circle cx="12" cy="12" r="4" />
                <path
                  d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              className="icon-btn"
              id="menuBtn"
              type="button"
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>
        </div>
        <div className={`mobile-menu${menuOpen ? ' open' : ''}`} id="mobileMenu">
          <a href="#top" onClick={() => setMenuOpen(false)}>
            Overview
          </a>
          <a href="#forecast" onClick={() => setMenuOpen(false)}>
            Forecast
          </a>
          <a href="#accuracy" onClick={() => setMenuOpen(false)}>
            Accuracy
          </a>
          <a href="#detail" onClick={() => setMenuOpen(false)}>
            Detail
          </a>
        </div>
      </header>

      <main>
        <section className="hero reveal" id="top">
          <h1>What will wind deliver tomorrow, and how much can we trust the forecast?</h1>
          <p>
            If wind delivers less than forecast, the desk must buy the difference on the
            day-ahead market. This page shows what was known at decision time, and how wrong
            those forecasts have been.
          </p>
          <div className="tags">
            <span className="tag">Elexon BMRS</span>
            <span className="tag">FUELHH</span>
            <span className="tag">WINDFOR</span>
            <span className="tag">January 2026</span>
            <span className="tag">National GB</span>
            <span className="tag">30-minute resolution</span>
            <span className="tag">All times UTC</span>
          </div>
          <div className="status-row">
            <span className="status-pill">
              <span className="dot green"></span>
              {month ? `${monthDays.length} delivery days · ${monthLabel(month.month)}` : 'January 2026'}
            </span>
            <span className="status-pill">
              <span className={`dot ${health?.source === 'snapshot' ? 'rose' : 'green'}`}></span>
              {sourcePill}
            </span>
          </div>
        </section>

        {!dashReady && !bootError && (
          <div className="load-panel">
            <b>Connecting to the WindDesk API…</b> Loading the January 2026 month summary
            and the highest-MAE delivery day.
          </div>
        )}

        {bootError && (
          <div className="error-panel">
            <h2>Could not load WindDesk data</h2>
            <p>
              {bootError} No figures are shown, because the app never renders placeholder
              numbers as data. Start the backend (see README), then retry.
            </p>
            <button type="button" onClick={() => setBootAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        )}

        {dashReady && (
          <>
            <div className="decision reveal">
              <div className="group">
                <label htmlFor="daySelect">Delivery day</label>
                <button id="prevDay" type="button" onClick={() => setDayIndex(selectedIndex - 1)}>
                  ← Prev
                </button>
                <select
                  id="daySelect"
                  value={selectedDate ?? ''}
                  onChange={(e) => setSelectedDate(e.target.value)}
                >
                  {monthDays.map((d) => (
                    <option key={d.date} value={d.date}>
                      {dayLabel(d.date)}
                    </option>
                  ))}
                </select>
                <button id="nextDay" type="button" onClick={() => setDayIndex(selectedIndex + 1)}>
                  Next →
                </button>
              </div>
              <div className="group">
                <label htmlFor="hz">Forecast age</label>
                <input
                  id="hz"
                  type="range"
                  min="4"
                  max="48"
                  value={hz}
                  aria-label="Forecast age in hours"
                  onChange={(e) => {
                    hzTouchedRef.current = true;
                    setHz(Number(e.target.value));
                  }}
                />
                <span className="age-val" id="hzl">
                  {hz} h
                </span>
              </div>
              <div className="fact" id="decisionFact">
                {day && (
                  <>
                    Decision made <b>{decisionDayLabel(day.date)}</b> · latest forecast
                    published <b>{publishedLabel(day.latest_run_published)}</b>
                    {!focusIsLatest && focusRun && (
                      <>
                        {' '}
                        · focus run <b>{focusRun.label}</b>
                        {focusAge !== null && <> (~{Math.round(focusAge)} h old)</>}
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="gate">
                Day-ahead decisions are made on D-1. Only forecasts published before the
                decision count — later revisions are ignored here.
              </div>
              <div className="countdown">
                <span>{config?.cutoff_note ?? `Day-ahead auction closes in (${config?.cutoff ?? '––:––'} UTC)`}</span>
                <b id="cd">{countdown}</b>
              </div>
            </div>

            {dayError && (
              <p className="day-error">
                {dayError}{' '}
                <button type="button" onClick={() => setDayAttempt((a) => a + 1)}>
                  Retry day
                </button>
              </p>
            )}

            <section className="kpi-row reveal">
              <div className="kpi">
                <div className="inner">
                  <div className="label">Forecast total, delivery day</div>
                  <div className="value" ref={kpiRef('kpiForecast')}>
                    –
                  </div>
                  <div className="sub">{focusRun ? focusRun.label : ''}</div>
                </div>
              </div>
              <div className="kpi">
                <div className="inner">
                  <div className="label">Actual outturn, delivery day</div>
                  <div className="value" ref={kpiRef('kpiActual')}>
                    –
                  </div>
                  <div className="sub">48 half-hours, metered wind</div>
                </div>
              </div>
              <div className="kpi">
                <div className="inner">
                  <div className="label">Mean absolute error (MAE)</div>
                  <div className="value" ref={kpiRef('kpiMae')}>
                    –
                  </div>
                  <div className="sub">
                    {kpis && (
                      <>
                        Bias{' '}
                        <b>
                          {kpis.bias_mw < 0 ? '' : '+'}
                          {fmt(kpis.bias_mw)} MW
                        </b>{' '}
                        · RMSE {fmt(kpis.rmse_mw)} MW
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="kpi warn">
                <div className="inner">
                  <div className="label">Largest shortfall to cover</div>
                  <div className="value" ref={kpiRef('kpiShort')}>
                    –
                  </div>
                  <div className="sub">
                    {kpis && (
                      <>
                        At <b>{kpis.largest_shortfall_time} UTC</b> — extra power needed
                        then
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="kpi-row reveal">
              <div className="kpi">
                <div className="inner">
                  <div className="label">Wind forecast, average</div>
                  <div className="value" ref={kpiRef('kpiAvg')}>
                    –
                  </div>
                  <div className="sub">
                    {day && (
                      <>
                        Peaks at <b>{gw(peak.v)} GW</b> around {day.times[peak.i]?.slice(0, 5)} UTC
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="kpi">
                <div className="inner">
                  <div className="label">Left to buy</div>
                  <div className="value dash" ref={kpiRef('kpiBuy')}>
                    –
                  </div>
                  <div className="sub">Demand data is not provided by the current API</div>
                </div>
              </div>
              <div className="kpi">
                <div className="inner">
                  <div className="label">Typical miss (January)</div>
                  <div className="value" ref={kpiRef('kpiMiss')}>
                    –
                  </div>
                  <div className="sub">
                    {janMeanBias !== null && (
                      <>
                        Mean across January · mean bias{' '}
                        <b>
                          {janMeanBias < 0 ? '' : '+'}
                          {fmt(janMeanBias)} MW
                        </b>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="kpi">
                <div className="inner">
                  <div className="label">Safety buffer</div>
                  <div className="value dash" ref={kpiRef('kpiBuf')}>
                    –
                  </div>
                  <div className="sub">Needs forecast spread data, not provided by the current API</div>
                </div>
              </div>
            </section>

            <div className="split reveal">
              <section className="panel" id="forecast">
                <h2>Forecast vs actual — delivery day</h2>
                <p className="desc">
                  Each line is one forecast run, identified by when it was published. The
                  latest run is the one the desk actually had at decision time. Click legend
                  items to hide or show runs.
                </p>
                <div id="mainChart" className="chart" ref={chartRef('mainChart')}></div>
                <p className="note" id="mainNote">
                  {mainNote}
                </p>
              </section>
              <section className="panel">
                <div className="turb">
                  <svg width="96" height="120" viewBox="0 0 120 150" aria-hidden="true">
                    <path d="M57 58h6l4 88H53z" fill="var(--faint)" />
                    <g
                      className="blade"
                      id="bl"
                      style={{ '--sp': `${clamp(9 - avgF / 2200, 1.2, 9)}s` } as React.CSSProperties}
                    >
                      <path d="M60 56L56 6h8z" fill="var(--text)" />
                      <path d="M60 56l43 24-4 6z" fill="var(--text)" />
                      <path d="M60 56L17 80l4 6z" fill="var(--text)" />
                    </g>
                    <circle cx="60" cy="56" r="5" fill="var(--emerald)" />
                  </svg>
                  <div>
                    <h2>Morning briefing</h2>
                    <p className="desc">Written fresh each time you change the day or forecast age.</p>
                  </div>
                </div>
                <p id="brief">
                  {day && focusRun && kpis && (
                    <>
                      For <em>{dowName(day.date)} {dayNum} Jan</em>, wind is forecast to
                      average <em>{gw(avgF)} GW</em>. The focus run&apos;s typical miss is{' '}
                      <em>{Math.round(kpis.mae_mw)} MW</em>, and the largest shortfall is{' '}
                      <em>{fmt(Math.abs(kpis.largest_shortfall_mw))} MW</em> at{' '}
                      <em>{kpis.largest_shortfall_time} UTC</em> — extra power needed then.
                    </>
                  )}
                </p>
              </section>
            </div>

            <div className="row2">
              <section className="panel reveal">
                <h2>Signed error through the day</h2>
                <p className="desc">
                  Error = actual minus forecast. Below zero means wind under-delivered and
                  the desk had to buy more.
                </p>
                <div id="errorChart" className="chart medium" ref={chartRef('errorChart')}></div>
              </section>
              <section className="panel reveal">
                <h2>How the forecast moved</h2>
                <p className="desc">
                  Total forecast energy for this delivery day, as revised by each published
                  run. The dashed line is what actually arrived.
                </p>
                <div id="revChart" className="chart medium" ref={chartRef('revChart')}></div>
              </section>
            </div>

            <section className="panel reveal">
              <h2>What is left to buy</h2>
              <p className="desc">
                Demand against the latest wind forecast. The red area is the gap the desk
                needs to fill from other sources in each half-hour.
              </p>
              <div className="chart medium">
                <div className="empty-note">
                  Demand data is not provided by the current API, so the demand gap cannot
                  be drawn. This panel will populate when the API adds a demand series.
                </div>
              </div>
            </section>

            <section className="panel reveal" id="accuracy">
              <h2>January accuracy — daily MAE, latest forecast run</h2>
              <p className="desc">
                One bar per delivery day. Click any bar to open that day above.{' '}
                <span id="monthSummary">
                  {janMeanMae !== null && janMeanBias !== null && (
                    <>
                      January mean MAE {fmt(janMeanMae)} MW · mean bias{' '}
                      {janMeanBias < 0 ? '' : '+'}
                      {fmt(janMeanBias)} MW (forecasts{' '}
                      {janMeanBias < 0 ? 'slightly high' : janMeanBias > 0 ? 'slightly low' : 'unbiased'}
                      ).
                    </>
                  )}
                </span>
              </p>
              <div id="monthChart" className="chart" ref={chartRef('monthChart')}></div>
            </section>

            <div className="row3">
              <section className="panel reveal">
                <h2>January, day by day</h2>
                <p className="desc">
                  Pick a delivery day. Greener days had smaller forecast errors (latest run).
                </p>
                <div id="cal">
                  {'MTWTFSS'.split('').map((l) => (
                    <span className="d" key={l}>
                      {l}
                    </span>
                  ))}
                  {Array.from({ length: firstDow }).map((_, i) => (
                    <i key={`blank-${i}`}></i>
                  ))}
                  {monthDays.map((d) => {
                    const dn = parseDay(d.date).getUTCDate();
                    return (
                      <button
                        key={d.date}
                        type="button"
                        style={{ background: calColor(d.mae_mw) }}
                        aria-label={`${dowName(d.date)} ${dn} January, average miss ${Math.round(d.mae_mw)} MW`}
                        className={d.date === selectedDate ? 'sel' : ''}
                        onClick={() => setSelectedDate(d.date)}
                      >
                        {dn}
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="panel reveal">
                <h2>Error grows with forecast age</h2>
                <p className="desc">Average miss (MW) across January, by hours before delivery.</p>
                {janExtraError ? (
                  <div className="chart small">
                    <div className="empty-note">
                      Forecast-age curves could not be computed: the January day data did
                      not load. Retry by reloading the page.
                    </div>
                  </div>
                ) : (
                  <div id="ageChart" className="chart small" ref={chartRef('ageChart')}></div>
                )}
                {janExtra && janExtra.age.some((v) => v === null) && (
                  <p className="note">Only ages with published runs are shown.</p>
                )}
              </section>
              <section className="panel reveal">
                <h2>How the misses are spread</h2>
                <p className="desc">
                  Forecast minus actual, all of January. Right of centre means the forecast
                  ran high.
                </p>
                {janExtraError ? (
                  <div className="chart small">
                    <div className="empty-note">
                      The January error distribution could not be computed: the January day
                      data did not load. Retry by reloading the page.
                    </div>
                  </div>
                ) : (
                  <div id="histChart" className="chart small" ref={chartRef('histChart')}></div>
                )}
              </section>
            </div>

            <section className="panel reveal" id="detail">
              <h2>Half-hour detail — delivery day</h2>
              <p className="desc">
                Latest forecast run against metered actuals. Shortfall means the desk needed
                extra power for that half-hour.
              </p>
              <div className="table-tools">
                <label>
                  <input
                    type="checkbox"
                    id="shortOnly"
                    checked={shortOnly}
                    onChange={(e) => setShortOnly(e.target.checked)}
                  />{' '}
                  Shortfalls only
                </label>
                <span className="note" id="tableCount" style={{ margin: 0 }}>
                  Showing {shownRows.length} of {tableRows.length} half-hours
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time (UTC)</th>
                      <th>Forecast (MW)</th>
                      <th>Actual (MW)</th>
                      <th>Error (MW)</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody id="detailBody">
                    {shownRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: '#A1A1AA' }}>
                          No shortfall half-hours on this day.
                        </td>
                      </tr>
                    ) : (
                      shownRows.map((r) => {
                        const cls = r.error < -100 ? 'neg' : r.error > 100 ? 'pos' : '';
                        const tagCls =
                          r.position === 'Shortfall'
                            ? 'short'
                            : r.position === 'Surplus'
                              ? 'surp'
                              : '';
                        return (
                          <tr key={r.time}>
                            <td>{r.time.slice(0, 5)}</td>
                            <td>{fmt(r.forecast)}</td>
                            <td>{fmt(r.actual)}</td>
                            <td className={cls}>
                              {r.error < 0 ? '−' : '+'}
                              {fmt(Math.abs(r.error))}
                            </td>
                            <td className={`tag ${tagCls}`}>{r.position}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="method reveal" id="method">
              <h2 style={{ fontSize: 20, marginBottom: 10 }}>How the numbers are computed</h2>
              <p>
                <b>Error</b> = actual − forecast for each half-hour. <b>MAE</b> = average
                of absolute errors. <b>Bias</b> = average of signed errors — a negative bias
                means forecasts overestimate on average, so the desk tends to under-buy.{' '}
                <b>RMSE</b> penalises large misses more heavily and is shown in the
                production app alongside MAE.
              </p>
              <p>
                <b>Sources.</b> Elexon BMRS: FUELHH actuals (fuelType WIND) and WINDFOR
                forecasts (publishTime + generation), national GB level, 30-minute
                resolution, January 2026 decisions only. {sourceSentence}
              </p>
              <p>
                <b>Lookahead rule.</b> For any delivery day, only forecast runs published
                before the day-ahead decision are used. That is what makes the accuracy
                numbers honest — a forecast published after the decision could never have
                informed it.
              </p>
            </section>

            <footer>
              <p>
                Built for the REint challenge · <b>WindDesk</b>
              </p>
              <p className="small">
                Sources: Elexon BMRS · FUELHH + WINDFOR · January 2026 · {sourceWord}
              </p>
            </footer>
          </>
        )}
      </main>

      <nav className="dock" id="dock">
        <a href="#top" data-sec="top" className={activeSec === 'top' ? 'active' : ''}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </svg>
          <span className="tip">Overview</span>
        </a>
        <a href="#forecast" data-sec="forecast" className={activeSec === 'forecast' ? 'active' : ''}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 20h18" />
            <path d="M6 16v-5M11 16V8M16 16v-8M21 16V5" strokeLinecap="round" />
          </svg>
          <span className="tip">Forecast</span>
        </a>
        <a href="#accuracy" data-sec="accuracy" className={activeSec === 'accuracy' ? 'active' : ''}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" />
          </svg>
          <span className="tip">Accuracy</span>
        </a>
        <a href="#detail" data-sec="detail" className={activeSec === 'detail' ? 'active' : ''}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 9v11" />
          </svg>
          <span className="tip">Detail</span>
        </a>
        <div className="sep"></div>
        <button id="themeBtnDock" type="button" aria-label="Toggle theme" onClick={toggleTheme}>
          {dark ? SUN_SVG : MOON_SVG}
        </button>
      </nav>

      <nav className="dock-mobile" id="dockMobile">
        <a href="#top" data-sec="top" className={activeSec === 'top' ? 'active' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </svg>
        </a>
        <a href="#forecast" data-sec="forecast" className={activeSec === 'forecast' ? 'active' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 20h18" />
            <path d="M6 16v-5M11 16V8M16 16v-8M21 16V5" strokeLinecap="round" />
          </svg>
        </a>
        <a href="#accuracy" data-sec="accuracy" className={activeSec === 'accuracy' ? 'active' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" strokeLinecap="round" />
          </svg>
        </a>
        <a href="#detail" data-sec="detail" className={activeSec === 'detail' ? 'active' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18M8 9v11" />
          </svg>
        </a>
      </nav>

      <div className="tick">
        <div>
          <b>Record</b>GB wind hit 23.88 GW on 25 March 2026 (NESO)
          <b>Q1 2026</b>Renewables supplied a record 53.1% of UK electricity (DESNZ)
          <b>March 2026</b>Wind and solar avoided about £1bn of gas imports (Carbon Brief)
          <b>Data</b>Elexon BMRS: FUELHH actuals and WINDFOR forecasts, 30-minute periods
          <b>Demo</b>
          {tickerTail}
        </div>
      </div>
    </>
  );
}
