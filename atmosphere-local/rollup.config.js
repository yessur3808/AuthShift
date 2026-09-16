const { spawn } = require('child_process');
const svelte = require('rollup-plugin-svelte');
const commonjs = require('@rollup/plugin-commonjs');
const terser = require('@rollup/plugin-terser');
const resolve = require('@rollup/plugin-node-resolve');
const livereload = require('rollup-plugin-livereload');
const css = require('rollup-plugin-css-only');
const autoPreprocess = require('svelte-preprocess');
const json = require('@rollup/plugin-json');

const production = !process.env.ROLLUP_WATCH;

function serve() {
	let server;

	function toExit() {
		if (server) server.kill(0);
	}

	return {
		writeBundle() {
			if (server) return;
			server = spawn('npm', ['run', 'start', '--', '--dev'], {
				stdio: ['ignore', 'inherit', 'inherit'],
				shell: true
			});

			process.on('SIGTERM', toExit);
			process.on('exit', toExit);
		}
	};
}

module.exports = {
	input: 'src/main.js',
	output: {
		sourcemap: true,
		format: 'iife',
		name: 'app',
		file: 'public/build/bundle.js'
	},
	plugins: [
		json(),
		svelte({
			preprocess: autoPreprocess(),
			compilerOptions: {
				dev: !production
			}
		}),
		css({ output: 'bundle.css' }),
		resolve({
			browser: true,
			dedupe: ['svelte'],
			exportConditions: ['svelte']
		}),
		commonjs(),
		!production && serve(),
		!production && livereload('public'),
		production && terser()
	],
	watch: {
		clearScreen: false
	}
};