import { useT } from '../hooks/useT';

/** Version, API attribution and the cached-data note. */
export function Footer() {
  const t = useT();
  return (
    <footer className="hud-footer">
      <div className="footer-row">
        <span className="footer-version">{t('footerVersion')}</span>
        <a
          href="https://codeforces.com/apiHelp"
          target="_blank"
          rel="noreferrer noopener"
          title={t('notAffiliated')}
        >
          {t('apiLink')}
        </a>
      </div>
      <p className="footer-note">{t('footerNote')}</p>
    </footer>
  );
}
