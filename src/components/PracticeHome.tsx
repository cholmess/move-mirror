import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
export function PracticeHome() {
  const { t } = useTranslation("practice");
  return <div className="page" data-testid="practice-home"><h1>{t("title")}</h1><p className="lede">{t("intro")}</p>
    <div className="practice-cards">{[
      ["errors", "errorsBody", "start", "/train"],
      ["play", "playBody", "playStart", "/sparring"],
      ["closed", "closedBody", "closedStart", "/sparring?topic=plans"],
    ].map(([title, body, action, to]) => <section className="card" key={title}><h2>{t(title)}</h2><p>{t(body)}</p><Link className="btn primary" to={to}>{t(action)}</Link></section>)}</div>
  </div>;
}
