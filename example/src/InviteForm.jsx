import { Button } from './Button';

// The "after" component: same job, written so a first-time user can follow it.
export function InviteForm() {
  return (
    <main>
      <h1>Invite a teammate</h1>
      <p>They will get an email with a link to join this project.</p>
      <form>
        <label htmlFor="if-email">Their work email</label>
        <input id="if-email" type="email" aria-describedby="if-email-help" />
        <p id="if-email-help">Enter a full email address, including the part after the @.</p>
        <Button variant="primary" type="submit">Send invitation</Button>
        <Button>Cancel and go back</Button>
      </form>
      <h2>Pending invitations</h2>
      <p>No one has been invited yet. Send your first invitation above to get started.</p>
    </main>
  );
}
