import {
  formatFiles,
  getProjects,
  NxJsonConfiguration,
  ProjectConfiguration,
  readNxJson,
  Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { ConvertToFlatConfigGeneratorSchema } from './schema';
import { findEslintFile } from '../utils/eslint-file';
import { convertEslintJsonToFlatConfig } from './converters/json-converter';

export async function convertToFlatConfigGenerator(
  tree: Tree,
  options: ConvertToFlatConfigGeneratorSchema
) {
  const eslintFile = findEslintFile(tree);
  if (!eslintFile) {
    throw new Error('Could not find root eslint file');
  }
  if (!eslintFile.endsWith('.json')) {
    throw new Error(
      'Only json eslint config files are supported for conversion'
    );
  }

  const eslintIgnoreFiles = new Set<string>(['.eslintignore']);

  // convert root eslint config to eslint.config.js
  convertRootToFlatConfig(tree, eslintFile);

  // convert project eslint files to eslint.config.js
  const projects = getProjects(tree);
  for (const [project, projectConfig] of projects) {
    convertProjectToFlatConfig(
      tree,
      project,
      projectConfig,
      readNxJson(tree),
      eslintIgnoreFiles
    );
  }

  // delete all .eslintignore files
  for (const ignoreFile of eslintIgnoreFiles) {
    tree.delete(ignoreFile);
  }

  // replace references in nx.json
  updateNxJsonConfig(tree);
  // install missing packages

  if (!options.skipFormat) {
    await formatFiles(tree);
  }
}

export default convertToFlatConfigGenerator;

function convertRootToFlatConfig(tree: Tree, eslintFile: string) {
  if (eslintFile.endsWith('.base.json')) {
    convertConfigToFlatConfig(
      tree,
      '',
      '.eslintrc.base.json',
      'eslint.base.config.js'
    );
  }
  convertConfigToFlatConfig(tree, '', '.eslintrc.json', 'eslint.config.js');
}

function convertProjectToFlatConfig(
  tree: Tree,
  project: string,
  projectConfig: ProjectConfiguration,
  nxJson: NxJsonConfiguration,
  eslintIgnoreFiles: Set<string>
) {
  if (tree.exists(`${projectConfig.root}/.eslintrc.json`)) {
    if (projectConfig.targets) {
      const eslintTargets = Object.keys(projectConfig.targets || {}).filter(
        (t) => projectConfig.targets[t].executor === '@nx/eslint:lint'
      );
      let ignorePath: string | undefined;
      for (const target of eslintTargets) {
        // remove any obsolete `eslintConfig` options pointing to the old config file
        if (projectConfig.targets[target].options?.eslintConfig) {
          delete projectConfig.targets[target].options.eslintConfig;
        }
        if (projectConfig.targets[target].options?.ignorePath) {
          ignorePath = projectConfig.targets[target].options.ignorePath;
          delete projectConfig.targets[target].options.ignorePath;
        }
        updateProjectConfiguration(tree, project, projectConfig);
      }
      const nxHasLintTargets = Object.keys(nxJson.targetDefaults || {}).some(
        (t) =>
          (t === '@nx/eslint:lint' ||
            nxJson.targetDefaults[t].executor === '@nx/eslint:lint') &&
          projectConfig.targets?.[t]
      );
      if (nxHasLintTargets || eslintTargets.length > 0) {
        convertConfigToFlatConfig(
          tree,
          projectConfig.root,
          '.eslintrc.json',
          'eslint.config.js',
          ignorePath
        );
        eslintIgnoreFiles.add(`${projectConfig.root}/.eslintignore`);
        if (ignorePath) {
          eslintIgnoreFiles.add(ignorePath);
        }
      }
    }
  }
}

// update names of eslint files in nx.json
// and remove eslintignore
function updateNxJsonConfig(tree: Tree) {
  if (tree.exists('nx.json')) {
    updateJson(tree, 'nx.json', (json: NxJsonConfiguration) => {
      if (json.targetDefaults?.lint?.inputs) {
        const inputSet = new Set(json.targetDefaults.lint.inputs);
        inputSet.add('{workspaceRoot}/eslint.config.js');
        json.targetDefaults.lint.inputs = Array.from(inputSet);
      }
      if (json.targetDefaults?.['@nx/eslint:lint']?.inputs) {
        const inputSet = new Set(json.targetDefaults['@nx/eslint:lint'].inputs);
        inputSet.add('{workspaceRoot}/eslint.config.js');
        json.targetDefaults['@nx/eslint:lint'].inputs = Array.from(inputSet);
      }
      if (json.namedInputs?.production) {
        const inputSet = new Set(json.namedInputs.production);
        inputSet.add('!{projectRoot}/eslint.config.js');
        json.namedInputs.production = Array.from(inputSet);
      }
      return json;
    });
  }
}

function convertConfigToFlatConfig(
  tree: Tree,
  root: string,
  source: string,
  target: string,
  ignorePath?: string
) {
  const ignorePaths = ignorePath
    ? [ignorePath, `${root}/.eslintignore`]
    : [`${root}/.eslintignore`];
  convertEslintJsonToFlatConfig(tree, root, source, target, ignorePaths);
}
