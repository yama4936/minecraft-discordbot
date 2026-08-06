import Link from "next/link";
import { StatsDashboard } from "./stats-dashboard";

export default function StatsPage() {
  return (
    <>
      <header className="stats-header">
        <div className="hero-inner" style={{ paddingBlock: 0 }}>
          <nav className="stats-nav"><span className="eyebrow">PALWORLD SERVER STATUS</span><Link href="/">接続ガイドへ戻る</Link></nav>
          <h1 className="stats-title">サーバー統計</h1>
          <p className="stats-subtitle">オンライン状況、プレイ時間、レベル推移を確認できます。</p>
        </div>
      </header>
      <main className="shell"><StatsDashboard /></main>
    </>
  );
}
