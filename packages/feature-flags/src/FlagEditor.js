const fsx = require('fs-extra');
const path = require('path');

const getGitUsername = require('./gitTools/git-user-name');

const { ACTIONS } = require('./constants');

const CONFIG_DIRECTORY = 'features';
const FLAGS_FILENAME = 'flags.json';
const FEATURES_TYPEDEF_FILENAME = 'features.d.ts';
const ENVIRONMENTS_FILENAME = 'environments.json';
const ENABLE_DEBUG_LOGGING = process.env.NEAR_FLAG_DEBUG === 'true' || false;

class FlagEditor {
    constructor({ prompts }) {
        this.prompts = prompts;
        this._environments = null;
        this._flagsFilepath = null;
        this._flagsState = null;
    }

    log(...args) {
        ENABLE_DEBUG_LOGGING && console.log(...args);
    }

    async init() {
        const userEditing = await getGitUsername();
        this.log({ userEditing });

        await this.loadContext({ basePath: path.parse(process.cwd()) });
        await this.loadFlags(this._flagsFilepath);

        const flagNames = Object.keys(this._flagsState)

        const action = await this.prompts.action(flagNames.length !== 0);
        this.log({ action })

        let flagName;

        if (action === ACTIONS.REMOVE_FLAG) {
            flagName = await this.prompts.selectExistingFlag(flagNames)
            delete this._flagsState[flagName]
        } else {
            let flagEntry;

            if (action === ACTIONS.EDIT_FLAG) {
                flagName = await this.prompts.selectExistingFlag(flagNames)
            } else {
                flagName = await this.prompts.enterNewFlagName(flagNames);
            }
            this.log({ flagName });

            flagEntry = this._flagsState[flagName];
            const environmentsEnabledIn = await this.prompts.getEnvironmentStates({
                environments: this._environments,
                flagEntry
            });

            this._flagsState = {
                ...this._flagsState,
                [flagName]: this.flagEntry({ environmentsEnabledIn, flagEntry, userEditing })
            }
        }

        await this.saveFlags();
        await this.writeTypeDefinitions();
    }

    flagEntry({ environmentsEnabledIn, flagEntry, userEditing }) {
        this.log({ userEditing });

        const perEnvEntries = {};
        Object.values(this._environments).forEach((name) => {
            const perEnvEntry = (flagEntry && flagEntry[name]) || {};

            const enabled = environmentsEnabledIn.includes(name);
            let isEditing = (enabled !== perEnvEntry.enabled);

            perEnvEntries[name] = {
                ...perEnvEntry,
                enabled,
                lastEditedBy: !isEditing ? perEnvEntry.lastEditedBy : userEditing,
                lastEditedAt: !isEditing ? perEnvEntry.lastEditedAt : new Date().toISOString(),
            }
        })

        return {
            createdBy: flagEntry ? flagEntry.createdBy : userEditing,
            createdAt: flagEntry ? flagEntry.createdAt : new Date().toISOString(),
            ...perEnvEntries,
        }
    }

    async loadContext({ basePath }) {
        const { base, dir, root } = basePath;
        let fileFound = false;
        let currPath = path.join(dir, base);

        while (!fileFound && currPath && currPath !== root) {
            fileFound = await fsx.exists(path.join(currPath, CONFIG_DIRECTORY, FLAGS_FILENAME));

            if (!fileFound) {
                currPath = currPath
                    .split(path.sep)
                    .slice(0, -1)
                    .join(path.sep);
            }
        }

        if (!fileFound) {
            throw new Error(`Could not find a ${FLAGS_FILENAME} in CWD or any parent dir. Run this tool from a NEAR repo!`)
        }

        currPath = path.join(currPath, CONFIG_DIRECTORY);
        this._flagsFilepath = path.join(currPath, FLAGS_FILENAME);
        this._environments = await fsx.readJson(path.join(currPath, ENVIRONMENTS_FILENAME));
    }

    async loadFlags() {
        try {
            this._flagsState = await fsx.readJson(this._flagsFilepath)
        } catch (e) {
            console.log(e);
            throw new Error(`Failed to load JSON from ${this._flagsFilepath}. Probably not valid JSON!`)
        }
    }

    async saveFlags() {
        this.log("writing file", { filepath: this._flagsFilepath, state: this._flagsState });

        const flagOutput = Object.keys(this._flagsState)
            .sort()
            .reduce((flagsState, flagName) => {
                flagsState[flagName] = this._flagsState[flagName];
                return flagsState;
            }, {});

        return fsx.writeJson(this._flagsFilepath, flagOutput, { spaces: 2 });
    }

    async writeTypeDefinitions() {
        const typeDefPath = this._flagsFilepath.replace(FLAGS_FILENAME, FEATURES_TYPEDEF_FILENAME);

        const alphabetizedTypeDefs = Object.keys(this._flagsState)
            .sort()
            .map((flag) => `${flag}: boolean;`)
            .join('\n\t');

        const fileContent = `
/* This file is generated by the flag editor util. Changes will be lost! */

export type Features = {
    ${alphabetizedTypeDefs}
};
`;

        this.log("writing typedef file", { filepath: this._flagsFilepath, state: this._flagsState });
        return fsx.writeFile(typeDefPath, fileContent);
    }
}

module.exports = FlagEditor;
