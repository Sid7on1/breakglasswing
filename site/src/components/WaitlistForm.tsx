import { FormEvent, useId, useState } from 'react';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const WAITLIST_ENDPOINT = 'https://ougqqtvmmwqxlrnxncvf.supabase.co/functions/v1/waitlist';
// Supabase's legacy anon key is intentionally public and only authorizes the guarded Edge Function.
const WAITLIST_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91Z3FxdHZtbXdxeGxybnhuY3ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NDExMDAsImV4cCI6MjA5OTUxNzEwMH0.VP0fnooZPEnFYCzgxRVTMPCiTLQDgZhyMVP3RwWniEY';

export default function WaitlistForm({
  source,
  className = '',
}: {
  source: 'hero' | 'final';
  className?: string;
}) {
  const emailId = useId();
  const messageId = useId();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function joinWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'submitting') return;

    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: {
          apikey: WAITLIST_ANON_KEY,
          Authorization: `Bearer ${WAITLIST_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          source,
          website: data.get('website'),
          referrer: document.referrer || undefined,
        }),
      });

      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(result?.message || 'We could not save your email. Please try again.');
      }

      setStatus('success');
      setMessage(result?.message || "You're on the list. We'll email you when early access opens.");
      setEmail('');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'We could not save your email. Please try again.');
    }
  }

  const isSuccess = status === 'success';

  return (
    <div className={`waitlist-wrap ${className}`}>
      <form className="waitlist-form liquid-glass liquid-glass-form" onSubmit={joinWaitlist} aria-describedby={messageId}>
        <label className="sr-only" htmlFor={emailId}>Email address</label>
        <input
          id={emailId}
          type="email"
          name="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status !== 'idle') {
              setStatus('idle');
              setMessage('');
            }
          }}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          maxLength={254}
          required
          disabled={status === 'submitting' || isSuccess}
        />
        <div className="waitlist-honeypot" aria-hidden="true">
          <label htmlFor={`${emailId}-website`}>Website</label>
          <input id={`${emailId}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>
        <button type="submit" disabled={status === 'submitting' || isSuccess}>
          {status === 'submitting' ? 'Joining…' : isSuccess ? 'You’re in' : 'Join the waitlist'}
          <span aria-hidden>{isSuccess ? '✓' : '↗'}</span>
        </button>
      </form>
      <p
        id={messageId}
        className={`waitlist-message ${status === 'error' ? 'is-error' : ''} ${isSuccess ? 'is-success' : ''}`}
        role={status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {message || 'Launch news and early-access invites only. Unsubscribe anytime.'}
      </p>
    </div>
  );
}
