import { Link } from 'react-router-dom';
import { useTitle } from '../ui.jsx';

const UPDATED = '2 October 2026';

export function Privacy() {
  useTitle('Privacy policy');
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
        <h1>Privacy policy</h1>
        <p className="quiet">Last updated {UPDATED}</p>

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

        <h2>How we use it</h2>
        <ul>
          <li>To run the workspace: show leads, campaigns, calls, and reports to the business that owns them.</li>
          <li>To reply on WhatsApp and to create Meta ads that a registered business asks for. Ads are saved paused and go live only after the business approves.</li>
          <li>To write suggested replies and ad copy with an AI model.</li>
          <li>To keep accounts secure and to investigate misuse.</li>
        </ul>
        <p>We do not sell personal information.</p>

        <h2>Who we share it with</h2>
        <ul>
          <li><strong>Meta Platforms</strong> (Facebook, Instagram, WhatsApp): to send WhatsApp replies and to create or manage ads the business requests. A photo sent for an ad is uploaded to Meta.</li>
          <li><strong>Calling provider</strong> connected by the business (for example W-Caller): to read the business's own call and lead records.</li>
          <li><strong>AI model providers</strong> (OpenAI, Anthropic, or Google, depending on configuration): the message text needed to write a reply or ad copy.</li>
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
          <li>If you are a lead or customer of a business, ask that business, or contact Kala Akchar Media.</li>
          <li>If you messaged the AIRO WhatsApp number or have an AIRO account, contact Kala Akchar Media.</li>
          <li>Include the phone number or email address the data is linked to.</li>
        </ol>
        <p>We delete the information, except records we must keep by law, and confirm when it is done.</p>

        <h2>Changes</h2>
        <p>We will update this page when our practices change. The date at the top shows the latest version.</p>

        <h2>Contact</h2>
        <p>Kala Akchar Media, operator of AIRO.</p>
      </article>
    </div>
  );
}
