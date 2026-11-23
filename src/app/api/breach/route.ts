import { NextRequest, NextResponse } from 'next/server';
import { assess, draftNotification, type BreachIntake } from '@/lib/breach';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const intake: BreachIntake = {
      categories: Array.isArray(body.categories) ? body.categories : [],
      unauthorizedAcquisition: Boolean(body.unauthorizedAcquisition),
      riskOfSeriousHarm: Boolean(body.riskOfSeriousHarm),
      affectedCount: Math.max(0, Number(body.affectedCount) || 0),
      knownAt: body.knownAt ? new Date(body.knownAt) : new Date(),
    };

    if (Number.isNaN(intake.knownAt.getTime())) {
      return NextResponse.json({ error: 'knownAt is not a valid date' }, { status: 400 });
    }

    const assessment = assess(intake);

    const draft = assessment.notifiable
      ? draftNotification(intake, assessment, {
          name: String(body.orgName || '[Your organization]'),
          dpoName: String(body.dpoName || '[DPO name]'),
          dpoEmail: String(body.dpoEmail || '[DPO email]'),
          dpoPhone: String(body.dpoPhone || '[DPO phone]'),
        })
      : null;

    return NextResponse.json({ assessment, draft });
  } catch (err) {
    console.error('[breach]', err);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
