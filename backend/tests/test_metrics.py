"""Metric math: hand-computed cases, including None handling."""

from backend import metrics


def test_mixed_errors():
    f = [100, 200]
    a = [90, 210]
    t = ["00:00", "00:30"]
    assert metrics.mae(f, a) == 10
    assert metrics.bias(f, a) == 0
    assert metrics.rmse(f, a) == 10
    assert metrics.largest_shortfall(f, a, t) == (-10, "00:00")


def test_none_pairs_excluded():
    f = [100, None]
    a = [90, 210]
    assert metrics.mae(f, a) == 10
    assert metrics.bias(f, a) == -10
    assert metrics.rmse(f, a) == 10
    assert metrics.gwh(f) == 100 * 0.5 / 1000
    assert metrics.gwh(a) == 300 * 0.5 / 1000


def test_empty_gives_none():
    assert metrics.mae([None], [None]) is None
    assert metrics.bias([], []) is None
    assert metrics.rmse([None], [5]) is None
    assert metrics.gwh([None, None]) is None
    assert metrics.largest_shortfall([None], [None], ["00:00"]) == (None, None)
    assert metrics.kpis([None], [None], ["00:00"])["mae_mw"] is None


def test_constant_series():
    f = [100] * 48
    a = [150] * 48
    assert metrics.mae(f, a) == 50
    assert metrics.bias(f, a) == 50
    assert metrics.rmse(f, a) == 50
    assert metrics.gwh(f) == 2.4
    assert metrics.gwh(a) == 3.6
