import Link from "next/link";

const playerCommands = [
  ["/palworld join", "接続先とパスワードを本人だけに表示"],
  ["/palworld status", "サーバーの稼働状態を確認"],
  ["/palworld logs", "最新ログを確認"],
  ["/palworld players", "現在接続しているプレイヤーを表示"],
];

const adminCommands = [
  ["/palworld start", "サーバーを起動"],
  ["/palworld stop", "安全に停止"],
  ["/palworld restart", "サーバーを再起動"],
  ["/palworld password", "接続パスワードを変更"],
  ["/palworld kick", "プレイヤーを退出"],
  ["/palworld ban", "プレイヤーをBAN"],
  ["/palworld unban", "BANを解除"],
];

const troubleshooting = [
  ["接続がタイムアウトする", "接続先、ポート番号、インターネット接続を確認"],
  ["パスワードが違う", "Discordで /palworld join を再実行"],
  ["バージョンが違う", "Palworldを最新版へ更新"],
  ["サーバーが見つからない", "Discordで /palworld status を実行"],
  ["参加後すぐ終了する", "古いMODを外してゲームを再起動"],
];

export default function Home() {
  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <p className="eyebrow">PALWORLD DEDICATED SERVER</p>
          <h1>サーバー接続ガイド</h1>
          <p className="lead">Discordで接続情報を確認し、専用サーバーへ安全に参加するための手順です。</p>
          <div className="hero-actions">
            <a className="button primary" href="#join">参加手順を見る</a>
            <Link className="button secondary" href="/stats">サーバー統計を見る</Link>
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="notice">
          <strong>接続情報はDiscordで確認してください</strong>
          <p>接続先とパスワードは <code>/palworld join</code> を実行した本人だけに表示されます。外部へ共有しないでください。</p>
        </section>

        <section id="join" className="section">
          <div className="section-heading">
            <p className="section-number">01</p>
            <div><h2>サーバーへ参加する</h2><p>初回参加も、次の順番で進めれば接続できます。</p></div>
          </div>
          <ol className="steps">
            <li><div className="step-number">1</div><div><h3>Discordで接続情報を取得</h3><p>参加しているDiscordサーバーで <code>/palworld join</code> を実行し、接続先とパスワードを確認します。</p></div></li>
            <li><div className="step-number">2</div><div><h3>Palworldを起動</h3><p>タイトル画面から「マルチプレイに参加する（専用サーバー）」を選びます。</p></div></li>
            <li><div className="step-number">3</div><div><h3>パスワードを入力</h3><p>画面上部のパスワード欄へ、Discordで表示された文字列をそのまま入力します。</p></div></li>
            <li><div className="step-number">4</div><div><h3>接続先を入力</h3><p>画面下部の接続先欄へ、Discordに表示されたIPアドレスとポートを半角で入力します。</p></div></li>
            <li><div className="step-number">5</div><div><h3>接続してキャラクターを作成</h3><p>初回のみキャラクターを作成します。次回以降は同じキャラクターが自動で使われます。</p></div></li>
          </ol>
        </section>

        <section className="section">
          <div className="section-heading">
            <p className="section-number">02</p>
            <div><h2>接続できないとき</h2><p>まずゲームを更新・再起動し、接続情報を取り直してください。</p></div>
          </div>
          <div className="table-wrap">
            <table><thead><tr><th>症状</th><th>確認すること</th></tr></thead>
              <tbody>{troubleshooting.map(([symptom, action]) => <tr key={symptom}><td>{symptom}</td><td>{action}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-heading">
            <p className="section-number">03</p>
            <div><h2>Discord Botコマンド</h2><p>状態確認は全員が利用でき、サーバー操作は管理者だけが実行できます。</p></div>
          </div>
          <div className="command-grid">
            <div className="command-card"><h3>全員が利用可能</h3>{playerCommands.map(([command, description]) => <div className="command" key={command}><code>{command}</code><span>{description}</span></div>)}</div>
            <div className="command-card"><h3>管理者のみ</h3>{adminCommands.map(([command, description]) => <div className="command" key={command}><code>{command}</code><span>{description}</span></div>)}</div>
          </div>
          <aside className="warning"><strong>停止・再起動の前に連絡してください</strong><p>ほかのプレイヤーが遊んでいる可能性があります。Discordで事前に知らせてから操作してください。</p></aside>
        </section>

        <section className="section compact">
          <div className="section-heading">
            <p className="section-number">04</p>
            <div><h2>自動監視</h2><p>サーバー停止・復旧・保存容量不足をDiscordへ通知します。</p></div>
          </div>
          <p>異常通知を受け取ったら、管理者は <code>/palworld status</code> で状態を確認してください。</p>
        </section>
      </main>

      <footer><span>Palworld Server Guide</span><span>Updated 2026-08-06</span></footer>
    </>
  );
}
