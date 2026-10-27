"""Pure metric math for WindDesk. All values in MW unless noted.

error = actual - forecast (negative error = shortfall: the desk must buy
extra power beyond what wind was forecast to deliver).
MAE  = mean |error| ; bias = mean error ; RMSE = sqrt(mean error^2).
Daily GWh = sum(MW over half-hours) * 0.5h / 1000.
Pairs with a missing (None) side are excluded from every metric.
"""

import math
from typing import List, Optional, Tuple


def gwh(half_hour_mw: List[Optional[float]]) -> Optional[float]:
    vals = [v for v in half_hour_mw if v is not None]
    if not vals:
        return None
    # Missing half-hours contribute nothing; GWh is over present values only.
    return sum(vals) * 0.5 / 1000.0


def _pairs(forecast, actual):
    return [(f, a) for f, a in zip(forecast, actual) if f is not None and a is not None]


def mae(forecast, actual) -> Optional[float]:
    pairs = _pairs(forecast, actual)
    if not pairs:
        return None
    return sum(abs(a - f) for f, a in pairs) / len(pairs)


def bias(forecast, actual) -> Optional[float]:
    pairs = _pairs(forecast, actual)
    if not pairs:
        return None
    return sum(a - f for f, a in pairs) / len(pairs)


def rmse(forecast, actual) -> Optional[float]:
    pairs = _pairs(forecast, actual)
    if not pairs:
        return None
    return math.sqrt(sum((a - f) ** 2 for f, a in pairs) / len(pairs))


def largest_shortfall(forecast, actual, times) -> Tuple[Optional[float], Optional[str]]:
    """Most negative error and its half-hour label. If no error is negative
    (no shortfall occurred), the minimum error is still reported so callers
    always get a number; a non-negative value means 'no shortfall'."""
    pairs = [(a - f, t) for f, a, t in zip(forecast, actual, times)
             if f is not None and a is not None]
    if not pairs:
        return None, None
    err, t = min(pairs, key=lambda p: p[0])
    return err, t


def kpis(forecast, actual, times) -> dict:
    err, t = largest_shortfall(forecast, actual, times)
    return {
        "forecast_gwh": gwh(forecast),
        "actual_gwh": gwh(actual),
        "mae_mw": mae(forecast, actual),
        "bias_mw": bias(forecast, actual),
        "rmse_mw": rmse(forecast, actual),
        "largest_shortfall_mw": err,
        "largest_shortfall_time": t,
    }
