import './globals.css';

export const metadata = {
  title: 'forgeAI',
  description: 'Generate a cover letter, skills list, and recruiter email from resume + job description.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
