import { Link } from 'react-router-dom';
import { useTitle } from '../ui.jsx';

const UPDATED = '8 October 2026';
const CONTACT = 'contactkalaakchar@gmail.com';

function Legal({ title, children }) {
  useTitle(title);
  return (
    <div className="legal">
      <header className="legal-head">
        <Link to="/login" className="login-brand">
          <span className="mark" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M6 26 L16 5 L26 26 H21.2 L16 14.2 L10.8 26 Z" fill="currentColor" /></svg>
          </span>
          <span>AIRO</span>
        </Link>
      </header>
      <article className="legal-body">
        <p className="eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="quiet">Last updated {UPDATED}</p>
        {children}
        <p className="legal-links"><Link to="/privacy">Privacy policy</Link> · <Link to="/terms">Terms of service</Link></p>
      </article>
    </div>
  );
}

export function Privacy() {
  return (
    <Legal title="Privacy policy">
      <p>
        AIRO is a real estate growth and sales platform operated by Kala Akchar Media. This policy explains what
        information AIRO handles, why, and the choices you have.
      </p>

      <h2>Information we handle</h2>
      <ul>
        <li><strong>Account details:</strong> name, email address, phone number, and a hashed password for people who sign in to AIRO.</li>
        <li><strong>Business records:</strong> leads, campaigns, pipeline, tasks, and notes that a business adds to its workspace, including lead names, phone numbers, email addresses, and property preferences.</li>
        <li><strong>WhatsApp messages:</strong> when you message the AIRO WhatsApp number, we receive your phone number, WhatsApp profile name, the message text, and any photo you send so we can reply.</li>
        <li><strong>Connected services:</strong> when a business connects Meta Ads or a calling provider, AIRO reads the campaigns, ads, Pages, reports, leads, and call records that the business authorises.</li>
        <li><strong>Technical data:</strong> sign-in time, IP address, browser details, and an audit log of actions taken in AIRO.</li>
      </ul>

      <h2 id="google">Google Ads data</h2>
      <p>
        A business can connect its Google Ads account by signing in with Google. AIRO asks only for the Google Ads
        permission (<code>https://www.googleapis.com/auth/adwords</code>). It does not access Gmail, Drive, Contacts, or
        any other Google service.
      </p>
      <ul>
        <li><strong>What AIRO reads:</strong> the Google Ads accounts the user can access (account ID, name, currency, time zone), and for the account the business chooses: campaigns, budgets, ad groups, ads, keywords, search terms, locations, and performance numbers such as cost, impressions, clicks, and conversions. AIRO also requests keyword ideas and search volumes from Keyword Planner.</li>
        <li><strong>How AIRO uses it:</strong> to show the business its own Google Ads reports, to suggest keywords, ad text, and budget changes, and to create or edit campaigns when a user of that business asks for it. New campaigns are created paused and go live only after the business approves.</li>
        <li><strong>Storage:</strong> the Google sign-in token is stored encrypted on our servers and is never shown in the browser. Report data is kept in the business's workspace only.</li>
        <li><strong>Sharing:</strong> campaign names, keywords, and performance numbers may be sent to the AI model provider the business has set up, only to write the suggestions the user asked for. Google Ads data is not sold, not used for advertising, and not shared with other businesses on AIRO.</li>
        <li><strong>Removal:</strong> disconnecting Google Ads in AIRO Connections stops all reading and changes. You can also remove AIRO's access at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">myaccount.google.com/permissions</a>. To have the stored token and Google Ads data deleted, follow the steps under <a href="#data-deletion">Deleting your data</a>.</li>
      </ul>
      <p>
        AIRO's use and transfer of information received from Google APIs follows the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements. AIRO does not use Google user data to develop, improve, or train
        general AI or machine learning models.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>To run the workspace: show leads, campaigns, calls, and reports to the business that owns them.</li>
        <li>To reply on WhatsApp and to create Meta or Google ads that a registered business asks for. Ads are saved paused and go live only after the business approves.</li>
        <li>To write suggested replies and ad copy with an AI model.</li>
        <li>To keep accounts secure and to investigate misuse.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li><strong>Meta Platforms</strong> (Facebook, Instagram, WhatsApp): to send WhatsApp replies and to create or manage ads the business requests. A photo sent for an ad is uploaded to Meta.</li>
        <li><strong>Google</strong>: to read reports from and make changes in the Google Ads account the business connected.</li>
        <li><strong>Calling provider</strong> connected by the business (for example Call Yatri): to read the business's own call and lead records.</li>
        <li><strong>AI model providers</strong> (OpenAI, Anthropic, or Google, depending on configuration): the text needed to write a reply, ad copy, or a suggestion.</li>
        <li>Authorities, when the law requires it.</li>
      </ul>
      <p>Each business sees only its own workspace data. Other businesses using AIRO cannot see it.</p>

      <h2>Storage and security</h2>
      <p>
        Passwords are stored as hashes. Keys and tokens for connected services are stored encrypted. Access inside a
        workspace is limited by role (Owner, Admin, Member, Viewer).
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep information while the business account is active and as needed to provide the service. A business can
        remove leads and disconnect services at any time. When a connection is removed, AIRO stops reading from it.
      </p>

      <h2 id="data-deletion">Deleting your data</h2>
      <p>To ask us to delete your information:</p>
      <ol>
        <li>If you are a lead or customer of a business, ask that business, or email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
        <li>If you messaged the AIRO WhatsApp number or have an AIRO account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
        <li>Include the phone number or email address the data is linked to.</li>
      </ol>
      <p>We delete the information, except records we must keep by law, and confirm when it is done.</p>

      <h2>Changes</h2>
      <p>We will update this page when our practices change. The date at the top shows the latest version.</p>

      <h2>Contact</h2>
      <p>Kala Akchar Media, operator of AIRO. Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </Legal>
  );
}

export function Terms() {
  return (
    <Legal title="Terms of service">
      <p>
        These terms cover the use of AIRO, a real estate growth and sales platform operated by Kala Akchar Media
        ("we"). By signing in to AIRO you agree to them on behalf of yourself and the business you work for.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>AIRO accounts are created for registered businesses. Keep your password private and tell us if you think your account was misused.</li>
        <li>The business Owner decides who joins the workspace and what role each person has.</li>
      </ul>

      <h2>Your data and connected services</h2>
      <ul>
        <li>The business owns the leads, records, and reports in its workspace.</li>
        <li>When you connect Meta, Google Ads, a calling provider, or another service, you confirm you are allowed to give AIRO access to that account. You can disconnect it at any time in Connections.</li>
        <li>Your use of those services also follows their own terms, such as the Google Ads and Meta advertising policies.</li>
        <li>How we handle data is described in the <Link to="/privacy">privacy policy</Link>.</li>
      </ul>

      <h2>Ads and spending</h2>
      <ul>
        <li>AIRO creates new ads and campaigns paused. They go live only when a user of the business approves and publishes them.</li>
        <li>Ad spend is charged by the ad platform to the business's own ad account. The business is responsible for its budgets, ad content, and compliance with advertising rules.</li>
        <li>AI suggestions can be wrong. Review them before you approve.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not use AIRO to send spam, to mislead people, to break the law, or to access data you are not allowed to
        see. We may suspend accounts that do.
      </p>

      <h2>Service and liability</h2>
      <p>
        We work to keep AIRO available and accurate, but the service is provided as is. Data from connected services
        can be delayed or incomplete. To the extent the law allows, we are not liable for indirect losses or for
        results of ads or decisions taken in AIRO.
      </p>

      <h2>Ending use</h2>
      <p>
        A business can stop using AIRO at any time and ask us to delete its data as described in the{' '}
        <Link to="/privacy#data-deletion">privacy policy</Link>.
      </p>

      <h2>Changes</h2>
      <p>We will update this page when the terms change. The date at the top shows the latest version.</p>

      <h2>Contact</h2>
      <p>Kala Akchar Media, operator of AIRO. Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    </Legal>
  );
}
