"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var path_1 = require("path");
var fs = require("fs");
var core_1 = require("@babel/core");
var __1 = require("../");
function trim(str) {
    return String(str).replace(/^\s+|\s+$/, '');
}
var skipOutputTests = [
    'additionalComponentNames',
    'empty',
    'extractFromFormatMessageCall',
    'extractFromFormatMessageCallStateless',
    'extractSourceLocation',
    'icuSyntax',
    'idInterpolationPattern',
    'inline',
    'moduleSourceName',
    'noMessagesDir',
    'outputEmptyJson',
    'overrideIdFn',
    'removeDefaultMessage',
    'removeDescriptions',
    'workspaceRoot',
];
describe('emit asserts for: ', function () {
    fs.readdirSync((0, path_1.join)(__dirname, 'fixtures')).map(function (caseName) {
        if (skipOutputTests.indexOf(caseName) >= 0)
            return;
        it("output match: ".concat(caseName), function () {
            var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', caseName);
            var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
            var _a = transform(filePath, {
                pragma: '@react-intl',
            }), actual = _a.code, metadata = _a.metadata;
            expect(metadata['react-intl']).toMatchSnapshot();
            // Check code output
            expect(trim(actual)).toMatchSnapshot();
            // Check message output
            expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
        });
    });
});
describe('options', function () {
    it('removeDefaultMessage should remove default message', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'removeDefaultMessage');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var actual = transform(filePath, {
            removeDefaultMessage: true,
        }).code;
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('outputEmptyJson should output empty files', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'outputEmptyJson');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var actual = transform(filePath, {
            outputEmptyJson: true,
        }).code;
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('without outputEmptyJson should output empty files', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'empty');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var actual = transform(filePath, {}).code;
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
        // Check message output
        expect(fs.existsSync((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toBeFalsy();
    });
    it('correctly overrides the id when overrideIdFn is provided', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'overrideIdFn');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var actual = transform(filePath, {
            overrideIdFn: function (id, defaultMessage, description, filePath) {
                var filename = (0, path_1.basename)(filePath);
                return "".concat(filename, ".").concat(id, ".").concat(defaultMessage.length, ".").concat(typeof description);
            },
        }).code;
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('correctly overrides the id when idInterpolationPattern is provided', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'idInterpolationPattern');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var actual = transform(filePath, {
            idInterpolationPattern: '[sha512:contenthash:hex:6]',
        }).code;
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('removes descriptions when plugin is applied more than once', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'removeDescriptions');
        expect(function () {
            return transform((0, path_1.join)(fixtureDir, 'actual.js'), {}, {
                multiplePasses: true,
            });
        }).not.toThrow();
    });
    it('respects moduleSourceName', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'moduleSourceName');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                moduleSourceName: 'react-i18n',
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('should be able to parse inline defineMessage from react-intl', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'inline');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () { return transform(filePath); }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('respects extractSourceLocation', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'extractSourceLocation');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                extractSourceLocation: true,
            });
        }).not.toThrow();
        // Check message output
        var actualMessages = require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath));
        actualMessages.forEach(function (msg) {
            msg.file = msg.file.replace(/\/|\\/g, '@@sep@@');
        });
        expect(actualMessages).toMatchSnapshot();
    });
    it('respects extractFromFormatMessageCall', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'extractFromFormatMessageCall');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                extractFromFormatMessageCall: true,
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('respects extractFromFormatMessageCall from stateless components', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'extractFromFormatMessageCallStateless');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                extractFromFormatMessageCall: true,
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('additionalComponentNames', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'additionalComponentNames');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                additionalComponentNames: ['CustomMessage'],
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)(process.cwd(), __dirname, filePath))).toMatchSnapshot();
    });
    it('undefined messagesDir should work normally (w/o writing file)', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'noMessagesDir');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        var _a = transform(filePath, {
            pragma: '@react-intl',
            idInterpolationPattern: '[sha512:hash:base64:6]',
            messagesDir: undefined,
        }), actual = _a.code, metadata = _a.metadata;
        expect(metadata['react-intl']).toMatchSnapshot();
        // Check code output
        expect(trim(actual)).toMatchSnapshot();
    });
    it('workspaceRoot', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot', 'subdir1', 'subdir2');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                workspaceRoot: (0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot', 'subdir1'),
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)((0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot', 'subdir1'), __dirname, filePath))).toMatchSnapshot();
        expect(function () {
            return transform(filePath, {
                workspaceRoot: (0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot'),
            });
        }).not.toThrow();
        // Check message output
        expect(require((0, __1.resolveOutputPath)((0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot'), __dirname, filePath))).toMatchSnapshot();
    });
    it('workspaceRoot invalid', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot', 'subdir3');
        var filePath = (0, path_1.join)(fixtureDir, 'actual.js');
        expect(function () {
            return transform(filePath, {
                workspaceRoot: (0, path_1.join)(__dirname, 'fixtures', 'workspaceRoot', 'subdir1'),
            });
        }).toThrow();
    });
});
describe('errors', function () {
    it('Properly throws parse errors', function () {
        var fixtureDir = (0, path_1.join)(__dirname, 'fixtures', 'icuSyntax');
        expect(function () { return transform((0, path_1.join)(fixtureDir, 'actual.js')); }).toThrow(/Expected .* but "\." found/);
    });
});
var cacheBust = 1;
function transform(filePath, options, _a) {
    if (options === void 0) { options = {}; }
    var _b = _a === void 0 ? {} : _a, _c = _b.multiplePasses, multiplePasses = _c === void 0 ? false : _c;
    function getPluginConfig() {
        return [
            __1.default,
            __assign({ messagesDir: __dirname }, options),
            Date.now() + '' + ++cacheBust,
        ];
    }
    return (0, core_1.transformFileSync)(filePath, {
        plugins: multiplePasses
            ? [
                'module:@babel/plugin-syntax-jsx',
                getPluginConfig(),
                getPluginConfig(),
            ]
            : ['module:@babel/plugin-syntax-jsx', getPluginConfig()],
    });
}
