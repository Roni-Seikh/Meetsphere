import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Field } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';

export default function SettingsPage() {
  const { user, displayName, updateDisplayName, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const [name, setName] = useState(displayName);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await updateDisplayName(name.trim());
      setMsg({ kind: 'success', text: 'Profile saved.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save profile' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form onSubmit={save} className="space-y-4">
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <Field label="Email" value={user?.email ?? ''} disabled readOnly />
          <Field label="Display name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} hint="Shown to other participants in meetings." />
          <Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === displayName}>
            Save changes
          </Button>
        </form>
      </Card>
      <Card className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Appearance</h2>
          <p className="text-sm text-slate-500">Currently using the {dark ? 'dark' : 'light'} theme.</p>
        </div>
        <Button variant="secondary" onClick={toggle}>
          Switch to {dark ? 'light' : 'dark'}
        </Button>
      </Card>
      <Card className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Session</h2>
          <p className="text-sm text-slate-500">Sign out of this browser.</p>
        </div>
        <Button
          variant="danger"
          onClick={async () => {
            await signOut();
            navigate('/');
          }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
}
