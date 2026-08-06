"use client";

import type { PublicStats } from "@palworld/contracts";
import { useEffect, useMemo, useState } from "react";

const endpoint = process.env.NEXT_PUBLIC_STATS_API_URL || "/api/stats";

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}時間 ${rest}分` : `${rest}分`;
}

function OnlineChart({ points }: { points: PublicStats["online"] }) {
  const path = useMemo(() => {
    if (!points.length) return { line: "", area: "" };
    const width = 1000;
    const height = 220;
    const max = Math.max(1, ...points.map((point) => point.online));
    const first = points[0].timestamp;
    const span = Math.max(1, points.at(-1)!.timestamp - first);
    const coordinates = points.map((point) => ({
      x: ((point.timestamp - first) / span) * width,
      y: height - (point.online / max) * (height - 18),
    }));
    const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [points]);

  if (!points.length) return <div className="empty">統計データがまだありません。</div>;
  return <svg className="chart" role="img" aria-label="過去90日間のオンライン人数" viewBox="0 0 1000 220" preserveAspectRatio="none"><path className="chart-area" d={path.area} /><path className="chart-line" d={path.line} /></svg>;
}

export function StatsDashboard() {
  const [data, setData] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PublicStats>;
      })
      .then(setData)
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("統計情報を取得できませんでした。時間をおいて再読み込みしてください。");
      });
    return () => controller.abort();
  }, []);

  if (error) return <div className="panel error">{error}</div>;
  if (!data) return <div className="panel empty">統計情報を読み込んでいます…</div>;

  const totalPlayMinutes = data.players.reduce((sum, player) => sum + player.estimatedPlayMinutes, 0);
  return (
    <>
      <div className="stats-grid">
        <div className="metric"><div className="metric-label">現在オンライン</div><div className="metric-value"><span className="status-dot" />{data.latest?.online ?? 0}人</div></div>
        <div className="metric"><div className="metric-label">登録プレイヤー</div><div className="metric-value">{data.players.length}人</div></div>
        <div className="metric"><div className="metric-label">合計プレイ時間</div><div className="metric-value">{formatMinutes(totalPlayMinutes)}</div></div>
      </div>
      <section className="panel"><h2>オンライン推移</h2><OnlineChart points={data.online} /></section>
      <section className="panel"><h2>プレイヤー</h2>
        <div className="player-list">
          {data.players.map((player) => {
            const latest = player.history.at(-1);
            return <article className="player-card" key={player.id}><h3>{player.name}</h3><div className="player-meta"><span>Lv. {latest?.level ?? "-"}</span><span>{formatMinutes(player.estimatedPlayMinutes)}</span><span>{player.completedPlaySessions}セッション</span></div></article>;
          })}
        </div>
      </section>
    </>
  );
}
