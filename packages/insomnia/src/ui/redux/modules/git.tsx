import * as git from 'isomorphic-git';
import path from 'path';
import React, { ReactNode } from 'react';
import YAML from 'yaml';

import { SegmentEvent, trackSegmentEvent, vcsSegmentEventProperties } from '../../../common/analytics';
import { database as db } from '../../../common/database';
import { strings } from '../../../common/strings';
import * as models from '../../../models';
import { BaseModel } from '../../../models';
import type { GitRepository } from '../../../models/git-repository';
import { createGitRepository } from '../../../models/helpers/git-repository-operations';
import { isWorkspace, Workspace, WorkspaceScopeKeys } from '../../../models/workspace';
import { forceWorkspaceScopeToDesign } from '../../../sync/git/force-workspace-scope-to-design';
import { GIT_CLONE_DIR, GIT_INSOMNIA_DIR, GIT_INSOMNIA_DIR_NAME } from '../../../sync/git/git-vcs';
import { shallowClone } from '../../../sync/git/shallow-clone';
import { addDotGit, getOauth2FormatName, translateSSHtoHTTP } from '../../../sync/git/utils';
import { showAlert, showError, showModal } from '../../components/modals';
import { GitRepositorySettingsModal } from '../../components/modals/git-repository-settings-modal';
import { selectActiveProject } from '../selectors';
import { RootState } from '.';
import { loadStart, loadStop } from './global';
import { createWorkspace } from './workspace';

export type UpdateGitRepositoryCallback = (arg0: { gitRepository: GitRepository }) => void;

/**
 * Update git repository settings
 * */
export const updateGitRepository: UpdateGitRepositoryCallback = ({ gitRepository }) => {
  const providerName  = getOauth2FormatName(gitRepository.credentials);
  return () => {
    trackSegmentEvent(SegmentEvent.vcsSyncStart, { ...vcsSegmentEventProperties('git', 'update'), providerName });
    showModal(GitRepositorySettingsModal, {
      gitRepository,
      onSubmitEdits: async (gitRepoPatch: Partial<GitRepository>) => {
        await models.gitRepository.update(gitRepository, gitRepoPatch);
        trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'update'), providerName });
      },
    });
  };
};
export type SetupGitRepositoryCallback = (arg0: {
  createFsClient: () => git.PromiseFsClient;
  workspace: Workspace;
}) => void;

/**
 * Setup a git repository against a document
 * */
export const setupGitRepository: SetupGitRepositoryCallback = ({ createFsClient, workspace }) => {
  return (dispatch: any) => {
    trackSegmentEvent(SegmentEvent.vcsSyncStart, vcsSegmentEventProperties('git', 'setup'));
    showModal(GitRepositorySettingsModal, {
      gitRepository: null,
      onSubmitEdits: async (gitRepoPatch: GitRepository) => {
        const providerName  = getOauth2FormatName(gitRepoPatch.credentials);

        dispatch(loadStart());

        try {
          gitRepoPatch.needsFullClone = true;
          const fsClient = createFsClient();

          try {
            await shallowClone({
              fsClient,
              gitRepository: gitRepoPatch,
            });
          } catch (err) {
            showError({
              title: 'Error Cloning Repository',
              message: err.message,
              error: err,
            });
            trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'setup', err.message), providerName });
            return;
          }

          // If connecting a repo to a document and a workspace already exists in the repository, show an alert
          if (await containsInsomniaWorkspaceDir(fsClient)) {
            const workspaceBase = path.join(GIT_INSOMNIA_DIR, models.workspace.type);
            const workspaces = await fsClient.promises.readdir(workspaceBase);

            if (workspaces.length) {
              showAlert({
                title: 'Setup Problem',
                message:
                  'This repository is already connected to Insomnia; try creating a clone from the dashboard instead.',
              });
              trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'setup', 'existing insomnia data'), providerName });
              return;
            }
          }

          await createGitRepository(workspace._id, gitRepoPatch);
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'setup'), providerName });
        } catch (err) {
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'setup', err.message), providerName });
        } finally {
          dispatch(loadStop());
        }
      },
    });
  };
};

const containsInsomniaDir = async (fsClient: Record<string, any>): Promise<boolean> => {
  const rootDirs: string[] = await fsClient.promises.readdir(GIT_CLONE_DIR);
  return rootDirs.includes(GIT_INSOMNIA_DIR_NAME);
};

const containsInsomniaWorkspaceDir = async (fsClient: Record<string, any>): Promise<boolean> => {
  if (!(await containsInsomniaDir(fsClient))) {
    return false;
  }

  const rootDirs: string[] = await fsClient.promises.readdir(GIT_INSOMNIA_DIR);
  return rootDirs.includes(models.workspace.type);
};

const createWorkspaceWithGitRepo = (gitRepo: GitRepository) => {
  return (dispatch: any) =>
    dispatch(
      createWorkspace({
        scope: WorkspaceScopeKeys.design,
        onCreate: async wrk => {
          await createGitRepository(wrk._id, gitRepo);
        },
      }),
    );
};

const cloneProblem = (message: ReactNode) => {
  showAlert({
    title: 'Clone Problem',
    message,
  });
};

const noDocumentFound = (gitRepo: GitRepository) => {
  return (dispatch: any) => {
    showAlert({
      title: `No ${strings.document.singular.toLowerCase()} found`,
      okLabel: 'Yes',
      addCancel: true,
      message: `No ${strings.document.singular.toLowerCase()} found in the repository for import. Would you like to create a new one?`,
      onConfirm: () => dispatch(createWorkspaceWithGitRepo(gitRepo)),
    });
  };
};

/**
 * Clone a git repository
 * */
export const cloneGitRepository = ({ createFsClient }: {
  createFsClient: () => git.PromiseFsClient;
}) => {
  return (dispatch: any, getState: () => RootState) => {
    // TODO: in the future we should ask which project to clone into...?
    const activeProject = selectActiveProject(getState());

    trackSegmentEvent(SegmentEvent.vcsSyncStart, vcsSegmentEventProperties('git', 'clone'));
    showModal(GitRepositorySettingsModal, {
      gitRepository: null,
      onSubmitEdits: async (repoSettingsPatch: any) => {
        dispatch(loadStart());
        repoSettingsPatch.needsFullClone = true;
        repoSettingsPatch.uri = translateSSHtoHTTP(repoSettingsPatch.uri);
        let fsClient = createFsClient();

        const providerName = getOauth2FormatName(repoSettingsPatch.credentials);
        try {
          await shallowClone({
            fsClient,
            gitRepository: { ...repoSettingsPatch },
          });
        } catch (originalUriError) {
          if (repoSettingsPatch.uri.endsWith('.git')) {
            showAlert({
              title: 'Error Cloning Repository',
              message: originalUriError.message,
            });
            dispatch(loadStop());
            trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', originalUriError.message), providerName });
            return;
          }

          const dotGitUri = addDotGit(repoSettingsPatch.uri);

          try {
            fsClient = createFsClient();
            await shallowClone({
              fsClient,
              gitRepository: { ...repoSettingsPatch, uri: dotGitUri },
            });
            // by this point the clone was successful, so update with this syntax
            repoSettingsPatch.uri = dotGitUri;
          } catch (dotGitError) {
            showAlert({
              title: 'Error Cloning Repository: failed to clone with and without `.git` suffix',
              message: `Failed to clone with original url (${repoSettingsPatch.uri}): ${originalUriError.message};\n\nAlso failed to clone with \`.git\` suffix added (${dotGitUri}): ${dotGitError.message}`,
            });
            dispatch(loadStop());
            trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', dotGitError.message), providerName });
            return;
          }
        }

        // If no workspace exists, user should be prompted to create a document
        if (!(await containsInsomniaWorkspaceDir(fsClient))) {
          dispatch(noDocumentFound(repoSettingsPatch));
          dispatch(loadStop());
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', 'no directory found'), providerName });
          return;
        }

        const workspaceBase = path.join(GIT_INSOMNIA_DIR, models.workspace.type);
        const workspaces = await fsClient.promises.readdir(workspaceBase);

        if (workspaces.length === 0) {
          dispatch(noDocumentFound(repoSettingsPatch));
          dispatch(loadStop());
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', 'no workspaces found'), providerName });
          return;
        }

        if (workspaces.length > 1) {
          cloneProblem('Multiple workspaces found in repository; expected one.');
          dispatch(loadStop());
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', 'multiple workspaces found'), providerName });
          return;
        }

        // Only one workspace
        const workspacePath = path.join(workspaceBase, workspaces[0]);
        const workspaceJson = await fsClient.promises.readFile(workspacePath);
        const workspace = YAML.parse(workspaceJson.toString());
        // Check if the workspace already exists
        const existingWorkspace = await models.workspace.getById(workspace._id);

        if (existingWorkspace) {
          cloneProblem(
            <>
              Workspace <strong>{existingWorkspace.name}</strong> already exists. Please delete it
              before cloning.
            </>,
          );
          dispatch(loadStop());
          trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone', 'workspace already exists'), providerName });
          return;
        }

        // Prompt user to confirm importing the workspace
        showAlert({
          title: 'Project Found',
          okLabel: 'Import',
          message: (
            <>
              Workspace <strong>{workspace.name}</strong> found in repository. Would you like to
              import it?
            </>
          ),
          // Import all docs to the DB
          onConfirm: async () => {
            // Stop the DB from pushing updates to the UI temporarily
            const bufferId = await db.bufferChanges();

            // Loop over all model folders in root
            for (const modelType of await fsClient.promises.readdir(GIT_INSOMNIA_DIR)) {
              const modelDir = path.join(GIT_INSOMNIA_DIR, modelType);

              // Loop over all documents in model folder and save them
              for (const docFileName of await fsClient.promises.readdir(modelDir)) {
                const docPath = path.join(modelDir, docFileName);
                const docYaml = await fsClient.promises.readFile(docPath);
                const doc: BaseModel = YAML.parse(docYaml.toString());
                if (isWorkspace(doc)) {
                  // @ts-expect-error parentId can be string or null for a workspace
                  doc.parentId = activeProject?._id || null;
                }
                forceWorkspaceScopeToDesign(doc);
                await db.upsert(doc);
              }
            }

            // Store GitRepository settings and set it as active
            await createGitRepository(workspace._id, repoSettingsPatch);

            // Flush DB changes
            await db.flushChanges(bufferId);
            dispatch(loadStop());
            trackSegmentEvent(SegmentEvent.vcsSyncComplete, { ...vcsSegmentEventProperties('git', 'clone'), providerName });
          },
        });
      },
    });
  };
};
