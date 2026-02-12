import { Router } from 'express';

import { authRouter } from './auth.js';
import { workspaceRouter } from './workspaces.js';
import { fileRouter } from './files.js';
import { gitRouter } from './git.js';
import { taskRouter } from './tasks.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/workspaces', workspaceRouter);
apiRouter.use('/files', fileRouter);
apiRouter.use('/git', gitRouter);
apiRouter.use('/tasks', taskRouter);
