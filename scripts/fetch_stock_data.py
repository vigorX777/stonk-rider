#!/usr/bin/env python3
"""Fetch and freeze the A-share datasets used by Leek Knight."""

from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import akshare as ak


STOCKS = [
    ("600519", "贵州茅台", "SH", "消费"),
    ("300750", "宁德时代", "SZ", "新能源"),
    ("002594", "比亚迪", "SZ", "汽车"),
    ("601318", "中国平安", "SH", "金融"),
    ("600036", "招商银行", "SH", "银行"),
    ("601899", "紫金矿业", "SH", "有色金属"),
    ("600900", "长江电力", "SH", "公用事业"),
    ("000333", "美的集团", "SZ", "家用电器"),
    ("600276", "恒瑞医药", "SH", "医药生物"),
    ("300059", "东方财富", "SZ", "金融科技"),
    ("300502", "新易盛", "SZ", "光通信"),
    ("300308", "中际旭创", "SZ", "光通信"),
    ("000725", "京东方A", "SZ", "电子"),
    ("603986", "兆易创新", "SH", "半导体"),
    ("688256", "寒武纪", "SH", "人工智能"),
    ("688041", "海光信息", "SH", "半导体"),
    ("601138", "工业富联", "SH", "电子制造"),
    ("002475", "立讯精密", "SZ", "电子制造"),
    ("002371", "北方华创", "SZ", "半导体设备"),
    ("300274", "阳光电源", "SZ", "新能源"),
]

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "data" / "stocks"


def finite(value: object) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Non-finite market value: {value}")
    return number


def metrics(closes: list[float]) -> tuple[float, float, float]:
    returns = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
    mean = sum(returns) / len(returns)
    variance = sum((item - mean) ** 2 for item in returns) / max(1, len(returns) - 1)
    volatility = math.sqrt(variance) * math.sqrt(250)
    peak = closes[0]
    max_drawdown = 0.0
    for close in closes:
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, close / peak - 1)
    return closes[-1] / closes[0] - 1, volatility, max_drawdown


def difficulty(volatility: float, max_drawdown: float) -> str:
    score = volatility + abs(max_drawdown) * 0.55
    if score >= 0.62:
        return "HARD"
    if score >= 0.38:
        return "MEDIUM"
    return "EASY"


def fetch(code: str, exchange: str):
    start = (date.today() - timedelta(days=400)).strftime("%Y%m%d")
    end = date.today().strftime("%Y%m%d")
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            frame = ak.stock_zh_a_daily(
                symbol=f"{exchange.lower()}{code}",
                start_date=start,
                end_date=end,
                adjust="qfq",
            )
            if frame.empty:
                raise RuntimeError("empty response")
            return frame.tail(250).reset_index(drop=True)
        except Exception as error:  # pragma: no cover - network boundary
            last_error = error
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {code}: {last_error}")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    index: list[dict[str, object]] = []

    for position, (code, name, exchange, sector) in enumerate(STOCKS, start=1):
        print(f"[{position:02d}/{len(STOCKS)}] {code} {name}", flush=True)
        frame = fetch(code, exchange)
        candles = []
        for _, row in frame.iterrows():
            candles.append(
                {
                    "date": str(row["date"]),
                    "open": finite(row["open"]),
                    "high": finite(row["high"]),
                    "low": finite(row["low"]),
                    "close": finite(row["close"]),
                    "volume": finite(row["volume"]),
                    "amount": finite(row["amount"]),
                }
            )
        closes = [item["close"] for item in candles]
        one_year_return, volatility, max_drawdown = metrics(closes)
        metadata = {
            "code": code,
            "name": name,
            "exchange": exchange,
            "sector": sector,
            "difficulty": difficulty(volatility, max_drawdown),
            "dataStart": candles[0]["date"],
            "dataEnd": candles[-1]["date"],
            "tradingDays": len(candles),
            "oneYearReturn": round(one_year_return, 6),
            "volatility": round(volatility, 6),
            "maxDrawdown": round(max_drawdown, 6),
        }
        payload = {
            "metadata": metadata,
            "source": "AKShare stock_zh_a_daily / Sina",
            "generatedAt": generated_at,
            "adjustment": "qfq",
            "candles": candles,
        }
        (OUTPUT / f"{code}.json").write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        index.append(metadata)
        time.sleep(0.35)

    (OUTPUT / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} datasets to {OUTPUT}")


if __name__ == "__main__":
    main()
