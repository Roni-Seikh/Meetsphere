import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Field } from '../components/ui';
import { extractCode } from '../lib/api';

export default function JoinMeetingPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = extractCode(value);
    if (!code) return setError('Enter a meeting ID like abc-defg-hij, or paste the full invite link.');
    navigate(`/room/${code}`);
  };

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="mb-1 text-xl font-semibold">Join a meeting</h1>
      <p className="mb-5 text-sm text-slate-500">Ask the host for the meeting ID or invite link.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Meeting ID or link"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="abc-defg-hij"
          error={error}
          autoFocus
        />
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </Card>
  );
}
