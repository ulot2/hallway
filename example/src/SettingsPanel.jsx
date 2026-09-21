import { Button } from './Button';

// The "before" component: everything here passes a linter and confuses a human.
export function SettingsPanel() {
  return (
    <div>
      <h3>Settings</h3>
      <p>Error: invalid.</p>
      <form>
        <label htmlFor="sp-name">Name</label>
        <input id="sp-name" type="text" />
        <label htmlFor="sp-email">Email</label>
        <input id="sp-email" type="email" />
        <Button variant="primary" type="submit">Submit</Button>
        <Button>OK</Button>
      </form>
      <h4>Members</h4>
      <p>No results.</p>
      <Button>Delete</Button>
    </div>
  );
}
