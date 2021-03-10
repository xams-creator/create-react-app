// @remove-on-eject-begin
/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// @remove-on-eject-end
'use strict';

// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';

// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', err => {
    throw err;
});

// Ensure environment variables are read.
require('../config/env');
// @remove-on-eject-begin
// Do the preflight checks (only happens before eject).
const verifyPackageTree = require('./utils/verifyPackageTree');
if (process.env.SKIP_PREFLIGHT_CHECK !== 'true') {
    verifyPackageTree();
}
const verifyTypeScriptSetup = require('./utils/verifyTypeScriptSetup');
verifyTypeScriptSetup();
// @remove-on-eject-end

const path = require('path');
const chalk = require('react-dev-utils/chalk');
const fs = require('fs-extra');
const bfj = require('bfj');   // 一个读写json文件的库
const webpack = require('webpack');
const configFactory = require('../config/webpack.config');  // webpack 配置，重点！
const paths = require('../config/paths');
const checkRequiredFiles = require('react-dev-utils/checkRequiredFiles');
const formatWebpackMessages = require('react-dev-utils/formatWebpackMessages'); // 格式化 webpack 的统计信息 stats
const printHostingInstructions = require('react-dev-utils/printHostingInstructions'); // 打印一堆帮助信息
const FileSizeReporter = require('react-dev-utils/FileSizeReporter');   // 一些无关紧要的东西，统计build文件大小
const printBuildError = require('react-dev-utils/printBuildError');     // 当出现build错误时用来打印错误的工具

const measureFileSizesBeforeBuild =
    FileSizeReporter.measureFileSizesBeforeBuild;
const printFileSizesAfterBuild = FileSizeReporter.printFileSizesAfterBuild;
const useYarn = fs.existsSync(paths.yarnLockFile);  // 根据是否存在 yarnLockFile 判断是否使用了yarn

// These sizes are pretty large. We'll warn for bundles exceeding them.
const WARN_AFTER_BUNDLE_GZIP_SIZE = 512 * 1024;
const WARN_AFTER_CHUNK_GZIP_SIZE = 1024 * 1024;

const isInteractive = process.stdout.isTTY;

// Warn and crash if required files are missing
if (!checkRequiredFiles([paths.appHtml, paths.appIndexJs])) {
    process.exit(1);
}

const argv = process.argv.slice(2);
const writeStatsJson = argv.indexOf('--stats') !== -1;  // 如果入参有 --stats，表示需要写 统计信息到build目录,无关紧要的

// Generate configuration
const config = configFactory('production'); // 产生 prod 的webpack compiler 配置

// We require that you explicitly set browsers and do not fall back to
// browserslist defaults.
const {checkBrowsers} = require('react-dev-utils/browsersHelper');
checkBrowsers(paths.appPath, isInteractive)
    .then(() => {
        // First, read the current file sizes in build directory.
        // This lets us display how much they changed later.
        return measureFileSizesBeforeBuild(paths.appBuild);
    })
    .then(previousFileSizes => {
        // Remove all content but keep the directory so that
        // if you're in it, you don't end up in Trash

        // 1.确保目录为空，如果不存在目录就创建目录.(清空 build 目录)
        fs.emptyDirSync(paths.appBuild);
        // Merge with the public folder
        // 2.复制 public 到 build 目录
        copyPublicFolder();

        // 3.通过webpack run 执行build
        // Start the webpack build
        return build(previousFileSizes);
    })
    .then(
        ({stats, previousFileSizes, warnings}) => {

            // 5.根据 run 的结果进行信息打印，基本可忽略
            if (warnings.length) {
                console.log(chalk.yellow('Compiled with warnings.\n'));
                console.log(warnings.join('\n\n'));
                console.log(
                    '\nSearch for the ' +
                    chalk.underline(chalk.yellow('keywords')) +
                    ' to learn more about each warning.'
                );
                console.log(
                    'To ignore, add ' +
                    chalk.cyan('// eslint-disable-next-line') +
                    ' to the line before.\n'
                );
            } else {
                console.log(chalk.green('Compiled successfully.\n'));
            }

            console.log('File sizes after gzip:\n');
            printFileSizesAfterBuild(
                stats,
                previousFileSizes,
                paths.appBuild,
                WARN_AFTER_BUNDLE_GZIP_SIZE,
                WARN_AFTER_CHUNK_GZIP_SIZE
            );
            console.log();

            const appPackage = require(paths.appPackageJson);
            const publicUrl = paths.publicUrlOrPath;
            const publicPath = config.output.publicPath;
            const buildFolder = path.relative(process.cwd(), paths.appBuild);
            printHostingInstructions(
                appPackage,
                publicUrl,
                publicPath,
                buildFolder,
                useYarn
            );
        },
        err => {
            const tscCompileOnError = process.env.TSC_COMPILE_ON_ERROR === 'true';
            if (tscCompileOnError) {
                console.log(
                    chalk.yellow(
                        'Compiled with the following type errors (you may want to check these before deploying your app):\n'
                    )
                );
                printBuildError(err);
            } else {
                console.log(chalk.red('Failed to compile.\n'));
                printBuildError(err);
                process.exit(1);
            }
        }
    )
    .catch(err => {
        if (err && err.message) {
            console.log(err.message);
        }
        process.exit(1);
    });

// Create the production build and print the deployment instructions.
function build(previousFileSizes) {
    console.log('Creating an optimized production build...');

    const compiler = webpack(config);
    return new Promise((resolve, reject) => {

        // 4.主要是 compiler.run ，其他内容不重要
        compiler.run((err, stats) => {
            let messages;
            if (err) {
                if (!err.message) {
                    return reject(err);
                }

                let errMessage = err.message;

                // Add additional information for postcss errors
                if (Object.prototype.hasOwnProperty.call(err, 'postcssNode')) {
                    errMessage +=
                        '\nCompileError: Begins at CSS selector ' +
                        err['postcssNode'].selector;
                }

                messages = formatWebpackMessages({
                    errors: [errMessage],
                    warnings: [],
                });
            } else {
                messages = formatWebpackMessages(
                    stats.toJson({all: false, warnings: true, errors: true})
                );
            }
            if (messages.errors.length) {
                // Only keep the first error. Others are often indicative
                // of the same problem, but confuse the reader with noise.
                if (messages.errors.length > 1) {
                    messages.errors.length = 1;
                }
                return reject(new Error(messages.errors.join('\n\n')));
            }
            if (
                process.env.CI &&
                (typeof process.env.CI !== 'string' ||
                    process.env.CI.toLowerCase() !== 'false') &&
                messages.warnings.length
            ) {
                console.log(
                    chalk.yellow(
                        '\nTreating warnings as errors because process.env.CI = true.\n' +
                        'Most CI servers set it automatically.\n'
                    )
                );
                return reject(new Error(messages.warnings.join('\n\n')));
            }

            const resolveArgs = {
                stats,
                previousFileSizes,
                warnings: messages.warnings,
            };

            if (writeStatsJson) {
                return bfj
                    .write(paths.appBuild + '/bundle-stats.json', stats.toJson())
                    .then(() => resolve(resolveArgs))
                    .catch(error => reject(new Error(error)));
            }

            return resolve(resolveArgs);
        });
    });
}

function copyPublicFolder() {
    fs.copySync(paths.appPublic, paths.appBuild, {
        dereference: true,
        filter: file => file !== paths.appHtml,
    });
}
