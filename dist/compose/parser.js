// ROME-TAG: 0x15FDE1
import * as fs from 'fs';
import yaml from 'js-yaml';
import { readFCL } from './fclParser.js';
export function readCompose(file = 'funesterie.yml') {
    try {
        if (fs.existsSync('funesterie.fcl')) {
            const fcl = readFCL('funesterie.fcl');
            if (fcl && fcl.service) {
                const modules = {};
                for (const k of Object.keys(fcl.service)) {
                    const s = fcl.service[k];
                    modules[k] = { path: s.path, port: s.port, token: s.token, env: s.env };
                }
                return { modules };
            }
        }
        if (!fs.existsSync(file))
            return null;
        const raw = fs.readFileSync(file, 'utf8');
        const doc = yaml.load(raw);
        if (!doc || !doc.modules)
            return null;
        return { modules: doc.modules };
    }
    catch (err) {
        return null;
    }
}
