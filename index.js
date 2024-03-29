"use strict";
/*
 * Copyright 2015, Yahoo Inc.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOutputPath = void 0;
var p = require("path");
var fs_extra_1 = require("fs-extra");
var intl_messageformat_parser_1 = require("intl-messageformat-parser");
var declare = require('@babel/helper-plugin-utils').declare;
var core_1 = require("@babel/core");
var types_1 = require("@babel/types");
var validate = require("schema-utils");
var OPTIONS_SCHEMA = require("./options.schema.json");
var ts_transformer_1 = require("@formatjs/ts-transformer");
var DEFAULT_COMPONENT_NAMES = ['FormattedMessage'];
var EXTRACTED = Symbol('ReactIntlExtracted');
var DESCRIPTOR_PROPS = new Set(['id', 'description', 'defaultMessage']);
function getICUMessageValue(messagePath, _a) {
    var _b = _a === void 0 ? {} : _a, _c = _b.isJSXSource, isJSXSource = _c === void 0 ? false : _c;
    if (!messagePath) {
        return '';
    }
    var message = getMessageDescriptorValue(messagePath);
    try {
        (0, intl_messageformat_parser_1.parse)(message);
    }
    catch (parseError) {
        if (isJSXSource &&
            messagePath.isLiteral() &&
            message.indexOf('\\\\') >= 0) {
            throw messagePath.buildCodeFrameError('[React Intl] Message failed to parse. ' +
                'It looks like `\\`s were used for escaping, ' +
                "this won't work with JSX string literals. " +
                'Wrap with `{}`. ' +
                'See: http://facebook.github.io/react/docs/jsx-gotchas.html');
        }
        throw messagePath.buildCodeFrameError('[React Intl] Message failed to parse. ' +
            'See: https://formatjs.io/docs/core-concepts/icu-syntax' +
            "\n".concat(parseError));
    }
    return message;
}
function evaluatePath(path) {
    var evaluated = path.evaluate();
    if (evaluated.confident) {
        return evaluated.value;
    }
    throw path.buildCodeFrameError('[React Intl] Messages must be statically evaluate-able for extraction.');
}
function getMessageDescriptorKey(path) {
    if (path.isIdentifier() || path.isJSXIdentifier()) {
        return path.node.name;
    }
    return evaluatePath(path);
}
function getMessageDescriptorValue(path) {
    if (!path) {
        return '';
    }
    if (path.isJSXExpressionContainer()) {
        path = path.get('expression');
    }
    // Always trim the Message Descriptor values.
    var descriptorValue = evaluatePath(path);
    return descriptorValue;
}
function createMessageDescriptor(propPaths) {
    return propPaths.reduce(function (hash, _a) {
        var keyPath = _a[0], valuePath = _a[1];
        var key = getMessageDescriptorKey(keyPath);
        if (DESCRIPTOR_PROPS.has(key)) {
            hash[key] = valuePath;
        }
        return hash;
    }, {
        id: undefined,
        defaultMessage: undefined,
        description: undefined,
    });
}
function evaluateMessageDescriptor(descriptorPath, isJSXSource, filename, idInterpolationPattern, overrideIdFn) {
    if (isJSXSource === void 0) { isJSXSource = false; }
    if (idInterpolationPattern === void 0) { idInterpolationPattern = '[contenthash:5]'; }
    var id = getMessageDescriptorValue(descriptorPath.id);
    var defaultMessage = getICUMessageValue(descriptorPath.defaultMessage, {
        isJSXSource: isJSXSource,
    });
    var description = getMessageDescriptorValue(descriptorPath.description);
    if (overrideIdFn) {
        id = overrideIdFn(id, defaultMessage, description, filename);
    }
    else if (!id && idInterpolationPattern && defaultMessage) {
        id = (0, ts_transformer_1.interpolateName)({ sourcePath: filename }, idInterpolationPattern, {
            content: description
                ? "".concat(defaultMessage, "#").concat(description)
                : defaultMessage,
        });
    }
    var descriptor = {
        id: id,
    };
    if (description) {
        descriptor.description = description;
    }
    if (defaultMessage) {
        descriptor.defaultMessage = defaultMessage;
    }
    return descriptor;
}
function storeMessage(_a, path, _b, workspaceRoot, filename, messages) {
    var id = _a.id, description = _a.description, defaultMessage = _a.defaultMessage;
    var extractSourceLocation = _b.extractSourceLocation;
    if (!id && !defaultMessage) {
        throw path.buildCodeFrameError('[React Intl] Message Descriptors require an `id` or `defaultMessage`.');
    }
    if (messages.has(id)) {
        console.log('save', id);
        var existing = messages.get(id);
        if (description !== existing.description ||
            defaultMessage !== existing.defaultMessage) {
            throw path.buildCodeFrameError("[React Intl] Duplicate message id: \"".concat(id, "\", ") +
                'but the `description` and/or `defaultMessage` are different.');
        }
    }
    var loc = {};
    if (extractSourceLocation) {
        loc = __assign({ file: p.relative(workspaceRoot, filename) }, path.node.loc);
    }
    messages.set(id, __assign({ id: id, description: description, defaultMessage: defaultMessage }, loc));
    console.log('🕵', id);
}
function referencesImport(path, mod, importedNames) {
    if (!(path.isIdentifier() || path.isJSXIdentifier())) {
        return false;
    }
    return importedNames.some(function (name) { return path.referencesImport(mod, name); });
}
function isFormatMessageDestructuring(scope) {
    var binding = scope.getBinding('formatMessage');
    var block = scope.block;
    var declNode = binding === null || binding === void 0 ? void 0 : binding.path.node;
    // things like `const {formatMessage} = intl; formatMessage(...)`
    if (core_1.types.isVariableDeclarator(declNode)) {
        // things like `const {formatMessage} = useIntl(); formatMessage(...)`
        if (core_1.types.isCallExpression(declNode.init)) {
            if (core_1.types.isIdentifier(declNode.init.callee)) {
                return declNode.init.callee.name === 'useIntl';
            }
        }
        return (core_1.types.isObjectPattern(declNode.id) &&
            declNode.id.properties.find(function (value) { return value.key.name === 'intl'; }));
    }
    // things like const fn = ({ intl: { formatMessage }}) => { formatMessage(...) }
    if (core_1.types.isFunctionDeclaration(block) &&
        block.params.length &&
        core_1.types.isObjectPattern(block.params[0])) {
        return block.params[0].properties.find(function (value) { return value.key.name === 'intl'; });
    }
    return false;
}
function isFormatMessageCall(callee, path) {
    if (callee.isIdentifier() &&
        callee.node.name === 'formatMessage' &&
        isFormatMessageDestructuring(path.scope)) {
        return true;
    }
    if (!callee.isMemberExpression()) {
        return false;
    }
    var object = callee.get('object');
    var property = callee.get('property');
    return (property.isIdentifier() &&
        property.node.name === 'formatMessage' &&
        !Array.isArray(object) &&
        // things like `intl.formatMessage`
        ((object.isIdentifier() && object.node.name === 'intl') ||
            // things like `this.props.intl.formatMessage`
            (object.isMemberExpression() &&
                object.get('property').node.name === 'intl')));
}
function assertObjectExpression(path, callee) {
    if (!path || !path.isObjectExpression()) {
        throw path.buildCodeFrameError("[React Intl] `".concat(callee.get('property').node.name, "()` must be ") +
            'called with an object expression with values ' +
            'that are React Intl Message Descriptors, also ' +
            'defined as object expressions.');
    }
    return true;
}
/**
 *
 * @param workspaceRoot
 * @param messagesDir
 * @param filename Absolute path to the file
 */
function resolveOutputPath(workspaceRoot, messagesDir, filename) {
    if (!filename.startsWith(workspaceRoot)) {
        throw new Error("File \"".concat(filename, "\" is not under workspace root \"").concat(workspaceRoot, "\".\nPlease configure workspaceRoot to be a folder that contains all files being extracted"));
    }
    var _a = p.parse(p.relative(workspaceRoot, filename)), name = _a.name, dir = _a.dir;
    return p.join(messagesDir, dir, "".concat(name, ".json"));
}
exports.resolveOutputPath = resolveOutputPath;
exports.default = declare(function (api, options) {
    api.assertVersion(7);
    validate(OPTIONS_SCHEMA, options, {
        name: 'babel-plugin-react-intl',
        baseDataPath: 'options',
    });
    var messagesDir = options.messagesDir, _a = options.workspaceRoot, workspaceRoot = _a === void 0 ? process.cwd() : _a, outputEmptyJson = options.outputEmptyJson, pragma = options.pragma;
    /**
     * Store this in the node itself so that multiple passes work. Specifically
     * if we remove `description` in the 1st pass, 2nd pass will fail since
     * it expect `description` to be there.
     * HACK: We store this in the node instance since this persists across
     * multiple plugin runs
     */
    function tagAsExtracted(path) {
        path.node[EXTRACTED] = true;
    }
    function wasExtracted(path) {
        return !!path.node[EXTRACTED];
    }
    return {
        pre: function () {
            if (!this.ReactIntlMessages) {
                this.ReactIntlMessages = new Map();
                this.ReactIntlMeta = {};
            }
        },
        post: function (state) {
            var filename = this.file.opts.filename;
            var _a = this, messages = _a.ReactIntlMessages, ReactIntlMeta = _a.ReactIntlMeta;
            var descriptors = Array.from(messages.values());
            state.metadata['react-intl'] = {
                messages: descriptors,
                meta: ReactIntlMeta,
            };
            var messagesFilename;
            if (messagesDir &&
                filename &&
                (messagesFilename = resolveOutputPath(workspaceRoot, messagesDir, filename)) &&
                (outputEmptyJson || descriptors.length)) {
                (0, fs_extra_1.outputJSONSync)(messagesFilename, descriptors);
            }
        },
        visitor: {
            Program: function (path) {
                var body = path.node.body;
                var ReactIntlMeta = this.ReactIntlMeta;
                if (!pragma) {
                    return;
                }
                for (var _i = 0, body_1 = body; _i < body_1.length; _i++) {
                    var leadingComments = body_1[_i].leadingComments;
                    if (!leadingComments) {
                        continue;
                    }
                    var pragmaLineNode = leadingComments.find(function (c) {
                        return c.value.includes(pragma);
                    });
                    if (!pragmaLineNode) {
                        continue;
                    }
                    pragmaLineNode.value
                        .split(pragma)[1]
                        .trim()
                        .split(/\s+/g)
                        .forEach(function (kv) {
                        var _a = kv.split(':'), k = _a[0], v = _a[1];
                        ReactIntlMeta[k] = v;
                    });
                }
            },
            JSXOpeningElement: function (path, _a) {
                var opts = _a.opts, filename = _a.file.opts.filename;
                var _b = opts.moduleSourceName, moduleSourceName = _b === void 0 ? 'react-intl' : _b, _c = opts.additionalComponentNames, additionalComponentNames = _c === void 0 ? [] : _c, removeDefaultMessage = opts.removeDefaultMessage, idInterpolationPattern = opts.idInterpolationPattern, overrideIdFn = opts.overrideIdFn;
                if (wasExtracted(path)) {
                    return;
                }
                var name = path.get('name');
                if (name.referencesImport(moduleSourceName, 'FormattedPlural')) {
                    if (path.node && path.node.loc)
                        console.warn("[React Intl] Line ".concat(path.node.loc.start.line, ": ") +
                            'Default messages are not extracted from ' +
                            '<FormattedPlural>, use <FormattedMessage> instead.');
                    return;
                }
                if (name.isJSXIdentifier() &&
                    (referencesImport(name, moduleSourceName, DEFAULT_COMPONENT_NAMES) ||
                        additionalComponentNames.includes(name.node.name))) {
                    var attributes = path
                        .get('attributes')
                        .filter(function (attr) { return attr.isJSXAttribute(); });
                    var descriptorPath = createMessageDescriptor(attributes.map(function (attr) { return [
                        attr.get('name'),
                        attr.get('value'),
                    ]; }));
                    // In order for a default message to be extracted when
                    // declaring a JSX element, it must be done with standard
                    // `key=value` attributes. But it's completely valid to
                    // write `<FormattedMessage {...descriptor} />`, because it will be
                    // skipped here and extracted elsewhere. The descriptor will
                    // be extracted only (storeMessage) if a `defaultMessage` prop.
                    if (descriptorPath.id || descriptorPath.defaultMessage) {
                        // Evaluate the Message Descriptor values in a JSX
                        // context, then store it.
                        var descriptor = evaluateMessageDescriptor(descriptorPath, true, filename, idInterpolationPattern, overrideIdFn);
                        storeMessage(descriptor, path, opts, workspaceRoot, filename, this.ReactIntlMessages);
                        var idAttr = void 0;
                        var descriptionAttr = void 0;
                        var defaultMessageAttr = void 0;
                        for (var _i = 0, attributes_1 = attributes; _i < attributes_1.length; _i++) {
                            var attr = attributes_1[_i];
                            if (!attr.isJSXAttribute()) {
                                continue;
                            }
                            switch (getMessageDescriptorKey(attr.get('name'))) {
                                case 'description':
                                    descriptionAttr = attr;
                                    break;
                                case 'defaultMessage':
                                    defaultMessageAttr = attr;
                                    break;
                                case 'id':
                                    idAttr = attr;
                                    break;
                            }
                        }
                        if (descriptionAttr) {
                            descriptionAttr.remove();
                        }
                        if (removeDefaultMessage && defaultMessageAttr) {
                            defaultMessageAttr.remove();
                        }
                        if (overrideIdFn || (descriptor.id && idInterpolationPattern)) {
                            if (idAttr) {
                                idAttr.get('value').replaceWith(core_1.types.stringLiteral(descriptor.id));
                            }
                            else if (defaultMessageAttr) {
                                defaultMessageAttr.insertBefore(core_1.types.jsxAttribute(core_1.types.jsxIdentifier('id'), core_1.types.stringLiteral(descriptor.id)));
                            }
                        }
                        // Tag the AST node so we don't try to extract it twice.
                        tagAsExtracted(path);
                    }
                }
            },
            CallExpression: function (path, _a) {
                var opts = _a.opts, filename = _a.file.opts.filename;
                var messages = this.ReactIntlMessages;
                var _b = opts.moduleSourceName, moduleSourceName = _b === void 0 ? 'react-intl' : _b, overrideIdFn = opts.overrideIdFn, idInterpolationPattern = opts.idInterpolationPattern, removeDefaultMessage = opts.removeDefaultMessage, extractFromFormatMessageCall = opts.extractFromFormatMessageCall;
                var callee = path.get('callee');
                /**
                 * Process MessageDescriptor
                 * @param messageDescriptor Message Descriptor
                 */
                function processMessageObject(messageDescriptor) {
                    assertObjectExpression(messageDescriptor, callee);
                    if (wasExtracted(messageDescriptor)) {
                        return;
                    }
                    var properties = messageDescriptor.get('properties');
                    var descriptorPath = createMessageDescriptor(properties.map(function (prop) {
                        return [prop.get('key'), prop.get('value')];
                    }));
                    // Evaluate the Message Descriptor values, then store it.
                    var descriptor = evaluateMessageDescriptor(descriptorPath, false, filename, idInterpolationPattern, overrideIdFn);
                    storeMessage(descriptor, messageDescriptor, opts, workspaceRoot, filename, messages);
                    // Remove description since it's not used at runtime.
                    messageDescriptor.replaceWith(core_1.types.objectExpression(__spreadArray([
                        core_1.types.objectProperty(core_1.types.stringLiteral('id'), core_1.types.stringLiteral(descriptor.id))
                    ], (!removeDefaultMessage && descriptor.defaultMessage
                        ? [
                            core_1.types.objectProperty(core_1.types.stringLiteral('defaultMessage'), core_1.types.stringLiteral(descriptor.defaultMessage)),
                        ]
                        : []), true)));
                    // Tag the AST node so we don't try to extract it twice.
                    tagAsExtracted(messageDescriptor);
                }
                // Check that this is `betterDefineMessages` call
                if (callee.isIdentifier({ name: 'betterDefineMessages' })) {
                    var fileId_1 = path.get('arguments')[0].node.value;
                    var messagesArg_1 = path.get('arguments')[1];
                    var properties = messagesArg_1.get('properties');
                    properties.forEach(function (prop) {
                        var key = prop.get('key');
                        var value = prop.get('value');
                        var id = "".concat(fileId_1, ".").concat(key.node.name);
                        var defaultMessage = getICUMessageValue(value, {
                            isJSXSource: true,
                        });
                        storeMessage({ id: id, defaultMessage: defaultMessage }, messagesArg_1, opts, workspaceRoot, filename, messages);
                    });
                    // Tag the AST node so we don't try to extract it twice.
                    tagAsExtracted(messagesArg_1);
                }
                // Check that this is `defineMessages` call
                if (isMultipleMessagesDeclMacro(callee, moduleSourceName) ||
                    isSingularMessagesDeclMacro(callee, moduleSourceName)) {
                    var firstArgument = path.get('arguments')[0];
                    var messagesObj = getMessagesObjectFromExpression(firstArgument);
                    try {
                        if (assertObjectExpression(messagesObj, callee)) {
                            if (isSingularMessagesDeclMacro(callee, moduleSourceName)) {
                                processMessageObject(messagesObj);
                            }
                            else {
                                var properties = messagesObj.get('properties');
                                if (Array.isArray(properties)) {
                                    properties
                                        .map(function (prop) { return prop.get('value'); })
                                        .forEach(processMessageObject);
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.log('⚠️⚠️⚠️', e);
                    }
                }
                // Check that this is `intl.formatMessage` call
                if (extractFromFormatMessageCall && isFormatMessageCall(callee, path)) {
                    var messageDescriptor = path.get('arguments')[0];
                    if (messageDescriptor.isObjectExpression()) {
                        try {
                            processMessageObject(messageDescriptor);
                        }
                        catch (e) {
                            console.log('⚠️⚠️⚠️', e);
                        }
                    }
                }
            },
        },
    };
});
function isMultipleMessagesDeclMacro(callee, moduleSourceName) {
    return referencesImport(callee, moduleSourceName, ['defineMessages']);
}
function isSingularMessagesDeclMacro(callee, moduleSourceName) {
    return referencesImport(callee, moduleSourceName, ['defineMessage']);
}
function getMessagesObjectFromExpression(nodePath) {
    var currentPath = nodePath;
    while ((0, types_1.isTSAsExpression)(currentPath.node) ||
        (0, types_1.isTSTypeAssertion)(currentPath.node) ||
        (0, types_1.isTypeCastExpression)(currentPath.node)) {
        currentPath = currentPath.get('expression');
    }
    return currentPath;
}
