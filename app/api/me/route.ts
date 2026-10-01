import { getViewer } from '@/lib/auth';
import { failure } from '@/lib/server';
import { UserError } from '@/lib/user-error';

export async function GET() {
  try {
    const viewer = await getViewer();
    if (!viewer) throw new UserError('Sign in to continue.', 401);
    return Response.json(
      { email: viewer.email, name: viewer.name, picture: viewer.picture, role: viewer.role },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
