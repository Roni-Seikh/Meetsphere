import { Lock, MessageSquare, MonitorUp, ShieldCheck, Users, Video } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../components/AppLayout';
import { Logo } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const features = [
  { icon: Video, title: 'Real WebRTC video', text: 'Peer-to-peer audio and video straight between browsers, no plugins.' },
  { icon: MessageSquare, title: 'Live chat', text: 'Messages are delivered instantly and saved with the meeting.' },
  { icon: MonitorUp, title: 'Screen sharing', text: 'Present your screen and switch back to your camera in one click.' },
  { icon: ShieldCheck, title: 'Host controls', text: 'Password-protect meetings, remove participants, end for everyone.' },
  { icon: Lock, title: 'Secure by design', text: 'Every request is verified on the server. Media is encrypted in transit.' },
  { icon: Users, title: 'Small-team friendly', text: 'Built for 2-8 people per meeting using a lightweight mesh design.' },
];

export default function LandingPage() {
  const { session } = useAuth();
  return (
    <div className="min-h-full">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {session ? (
            <Link to="/dashboard" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-200/60 dark:hover:bg-slate-800">
                Sign in
              </Link>
              <Link to="/register" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                Get started
              </Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Meetings that just work.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-400">
            Create a room, share the link, and talk face to face. Free, open source and built on standard web technology.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to={session ? '/meetings/new' : '/register'} className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500">
              {session ? 'New meeting' : 'Create a free account'}
            </Link>
            <Link to={session ? '/join' : '/login'} className="rounded-lg px-6 py-3 font-medium ring-1 ring-slate-300 hover:bg-white dark:ring-slate-700 dark:hover:bg-slate-900">
              Join with a code
            </Link>
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-5xl px-4 pb-20">
          <h2 id="features" className="sr-only">
            Features
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <Icon className="h-6 w-6 text-indigo-600" aria-hidden />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">
        MeetSphere is an educational portfolio project. Not affiliated with any video-conferencing vendor.
      </footer>
    </div>
  );
}
