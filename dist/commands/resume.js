import { resumeAll } from '../supervisor.js';
export default async function runResume(_argv = []) {
    resumeAll();
    console.log('QFLUSH resumed (normal mode)');
    return 0;
}
