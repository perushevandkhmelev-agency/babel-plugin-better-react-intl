/*
 * Copyright 2015, Yahoo Inc.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

import * as p from 'path';
import {outputJSONSync} from 'fs-extra';
import {parse} from 'intl-messageformat-parser';
const {declare} = require('@babel/helper-plugin-utils') as any;
import {PluginObj, types as t} from '@babel/core';

import {
  ObjectExpression,
  JSXAttribute,
  StringLiteral,
  JSXIdentifier,
  JSXExpressionContainer,
  Identifier,
  ObjectProperty,
  SourceLocation,
  Expression,
  V8IntrinsicIdentifier,
  isTSAsExpression,
  isTypeCastExpression,
  isTSTypeAssertion,
} from '@babel/types';
import {NodePath, Scope} from '@babel/traverse';
import * as validate from 'schema-utils';
import * as OPTIONS_SCHEMA from './options.schema.json';
import {OptionsSchema} from './options.js';
import {interpolateName} from '@formatjs/ts-transformer';

const DEFAULT_COMPONENT_NAMES = ['FormattedMessage'];

const EXTRACTED = Symbol('ReactIntlExtracted');
const DESCRIPTOR_PROPS = new Set(['id', 'description', 'defaultMessage']);

interface MessageDescriptor {
  id: string;
  defaultMessage?: string;
  description?: string;
}

export type ExtractedMessageDescriptor = MessageDescriptor &
  Partial<SourceLocation> & {file?: string};

export type ExtractionResult<M = Record<string, string>> = {
  messages: ExtractedMessageDescriptor[];
  meta: M;
};

type MessageDescriptorPath = Record<
  keyof MessageDescriptor,
  NodePath<StringLiteral> | undefined
>;

// From https://github.com/babel/babel/blob/master/packages/babel-core/src/transformation/plugin-pass.js
interface PluginPass<O> {
  key?: string;
  file: BabelTransformationFile;
  opts: O;
  cwd: string;
  filename?: string;
}

interface BabelTransformationFile {
  opts: {
    filename: string;
    babelrc: boolean;
    configFile: boolean;
    passPerPreset: boolean;
    envName: string;
    cwd: string;
    root: string;
    plugins: unknown[];
    presets: unknown[];
    parserOpts: object;
    generatorOpts: object;
  };
  declarations: {};
  path: NodePath | null;
  ast: {};
  scope: unknown;
  metadata: {};
  code: string;
  inputMap: object | null;
}

interface State {
  ReactIntlMessages: Map<string, ExtractedMessageDescriptor>;
  ReactIntlMeta: Record<string, string>;
}

function getICUMessageValue(
  messagePath?: NodePath<StringLiteral>,
  {isJSXSource = false} = {}
) {
  if (!messagePath) {
    return '';
  }
  const message = getMessageDescriptorValue(messagePath);

  try {
    parse(message);
  } catch (parseError) {
    if (
      isJSXSource &&
      messagePath.isLiteral() &&
      message.indexOf('\\\\') >= 0
    ) {
      throw messagePath.buildCodeFrameError(
        '[React Intl] Message failed to parse. ' +
          'It looks like `\\`s were used for escaping, ' +
          "this won't work with JSX string literals. " +
          'Wrap with `{}`. ' +
          'See: http://facebook.github.io/react/docs/jsx-gotchas.html'
      );
    }

    throw messagePath.buildCodeFrameError(
      '[React Intl] Message failed to parse. ' +
        'See: https://formatjs.io/docs/core-concepts/icu-syntax' +
        `\n${parseError}`
    );
  }
  return message;
}

function evaluatePath(path: NodePath<any>): string {
  const evaluated = path.evaluate();
  if (evaluated.confident) {
    return evaluated.value;
  }

  throw path.buildCodeFrameError(
    '[React Intl] Messages must be statically evaluate-able for extraction.'
  );
}

function getMessageDescriptorKey(path: NodePath<any>) {
  if (path.isIdentifier() || path.isJSXIdentifier()) {
    return path.node.name;
  }

  return evaluatePath(path);
}

function getMessageDescriptorValue(
  path?: NodePath<StringLiteral> | NodePath<JSXExpressionContainer>
) {
  if (!path) {
    return '';
  }
  if (path.isJSXExpressionContainer()) {
    path = path.get('expression') as NodePath<StringLiteral>;
  }

  // Always trim the Message Descriptor values.
  const descriptorValue = evaluatePath(path);

  return descriptorValue;
}

function createMessageDescriptor(
  propPaths: [
    NodePath<JSXIdentifier> | NodePath<Identifier>,
    NodePath<StringLiteral> | NodePath<JSXExpressionContainer>
  ][]
): MessageDescriptorPath {
  return propPaths.reduce(
    (hash: MessageDescriptorPath, [keyPath, valuePath]) => {
      const key = getMessageDescriptorKey(keyPath);

      if (DESCRIPTOR_PROPS.has(key)) {
        hash[key as 'id'] = valuePath as NodePath<StringLiteral>;
      }

      return hash;
    },
    {
      id: undefined,
      defaultMessage: undefined,
      description: undefined,
    }
  );
}

function evaluateMessageDescriptor(
  descriptorPath: MessageDescriptorPath,
  isJSXSource = false,
  filename: string,
  idInterpolationPattern: string = '[contenthash:5]',
  overrideIdFn?: OptionsSchema['overrideIdFn']
) {
  let id = getMessageDescriptorValue(descriptorPath.id);
  const defaultMessage = getICUMessageValue(descriptorPath.defaultMessage, {
    isJSXSource,
  });
  const description = getMessageDescriptorValue(descriptorPath.description);

  if (overrideIdFn) {
    id = overrideIdFn(id, defaultMessage, description, filename);
  } else if (!id && idInterpolationPattern && defaultMessage) {
    id = interpolateName(
      {sourcePath: filename} as any,
      idInterpolationPattern,
      {
        content: description
          ? `${defaultMessage}#${description}`
          : defaultMessage,
      }
    );
  }
  const descriptor: MessageDescriptor = {
    id,
  };

  if (description) {
    descriptor.description = description;
  }
  if (defaultMessage) {
    descriptor.defaultMessage = defaultMessage;
  }

  return descriptor;
}

function storeMessage(
  {id, description, defaultMessage}: MessageDescriptor,
  path: NodePath<any>,
  {extractSourceLocation}: OptionsSchema,
  workspaceRoot: string,
  filename: string,
  messages: Map<string, ExtractedMessageDescriptor>
) {
  if (!id && !defaultMessage) {
    throw path.buildCodeFrameError(
      '[React Intl] Message Descriptors require an `id` or `defaultMessage`.'
    );
  }

  if (messages.has(id)) {
    console.log('save', id);

    const existing = messages.get(id);

    if (
      description !== existing!.description ||
      defaultMessage !== existing!.defaultMessage
    ) {
      throw path.buildCodeFrameError(
        `[React Intl] Duplicate message id: "${id}", ` +
          'but the `description` and/or `defaultMessage` are different.'
      );
    }
  }

  let loc = {};
  if (extractSourceLocation) {
    loc = {
      file: p.relative(workspaceRoot, filename),
      ...path.node.loc,
    };
  }

  messages.set(id, {id, description, defaultMessage, ...loc});
  console.log('🕵', id);
}

function referencesImport(
  path: NodePath<any>,
  mod: string,
  importedNames: string[]
) {
  if (!(path.isIdentifier() || path.isJSXIdentifier())) {
    return false;
  }

  return importedNames.some(name => path.referencesImport(mod, name));
}

function isFormatMessageDestructuring(scope: Scope) {
  const binding = scope.getBinding('formatMessage');
  const {block} = scope;
  const declNode = binding?.path.node;
  // things like `const {formatMessage} = intl; formatMessage(...)`
  if (t.isVariableDeclarator(declNode)) {
    // things like `const {formatMessage} = useIntl(); formatMessage(...)`
    if (t.isCallExpression(declNode.init)) {
      if (t.isIdentifier(declNode.init.callee)) {
        return declNode.init.callee.name === 'useIntl';
      }
    }
    return (
      t.isObjectPattern(declNode.id) &&
      declNode.id.properties.find((value: any) => value.key.name === 'intl')
    );
  }

  // things like const fn = ({ intl: { formatMessage }}) => { formatMessage(...) }
  if (
    t.isFunctionDeclaration(block) &&
    block.params.length &&
    t.isObjectPattern(block.params[0])
  ) {
    return block.params[0].properties.find(
      (value: any) => value.key.name === 'intl'
    );
  }

  return false;
}

function isFormatMessageCall(
  callee: NodePath<Expression | V8IntrinsicIdentifier>,
  path: NodePath<any>
) {
  if (
    callee.isIdentifier() &&
    callee.node.name === 'formatMessage' &&
    isFormatMessageDestructuring(path.scope)
  ) {
    return true;
  }

  if (!callee.isMemberExpression()) {
    return false;
  }

  const object = callee.get('object');
  const property = callee.get('property') as NodePath<Identifier>;

  return (
    property.isIdentifier() &&
    property.node.name === 'formatMessage' &&
    !Array.isArray(object) &&
    // things like `intl.formatMessage`
    ((object.isIdentifier() && object.node.name === 'intl') ||
      // things like `this.props.intl.formatMessage`
      (object.isMemberExpression() &&
        (object.get('property') as NodePath<Identifier>).node.name === 'intl'))
  );
}

function assertObjectExpression(
  path: NodePath<any>,
  callee: NodePath<Expression | V8IntrinsicIdentifier>
): path is NodePath<ObjectExpression> {
  if (!path || !path.isObjectExpression()) {
    throw path.buildCodeFrameError(
      `[React Intl] \`${
        (callee.get('property') as NodePath<Identifier>).node.name
      }()\` must be ` +
        'called with an object expression with values ' +
        'that are React Intl Message Descriptors, also ' +
        'defined as object expressions.'
    );
  }
  return true;
}

/**
 *
 * @param workspaceRoot
 * @param messagesDir
 * @param filename Absolute path to the file
 */
export function resolveOutputPath(
  workspaceRoot: string,
  messagesDir: string,
  filename: string
) {
  if (!filename.startsWith(workspaceRoot)) {
    throw new Error(`File "${filename}" is not under workspace root "${workspaceRoot}".
Please configure workspaceRoot to be a folder that contains all files being extracted`);
  }
  const {name, dir} = p.parse(p.relative(workspaceRoot, filename));
  return p.join(messagesDir, dir, `${name}.json`);
}

export default declare((api: any, options: OptionsSchema) => {
  api.assertVersion(7);

  validate(OPTIONS_SCHEMA as any, options, {
    name: 'babel-plugin-react-intl',
    baseDataPath: 'options',
  });
  const {
    messagesDir,
    workspaceRoot = process.cwd(),
    outputEmptyJson,
    pragma,
  } = options;

  /**
   * Store this in the node itself so that multiple passes work. Specifically
   * if we remove `description` in the 1st pass, 2nd pass will fail since
   * it expect `description` to be there.
   * HACK: We store this in the node instance since this persists across
   * multiple plugin runs
   */
  function tagAsExtracted(path: NodePath<any>) {
    path.node[EXTRACTED] = true;
  }

  function wasExtracted(path: NodePath<any>) {
    return !!path.node[EXTRACTED];
  }
  return {
    pre() {
      if (!this.ReactIntlMessages) {
        this.ReactIntlMessages = new Map();
        this.ReactIntlMeta = {};
      }
    },

    post(state) {
      const {
        file: {
          opts: {filename},
        },
      } = this;

      const {ReactIntlMessages: messages, ReactIntlMeta} = this;
      const descriptors = Array.from(messages.values());
      (state as any).metadata['react-intl'] = {
        messages: descriptors,
        meta: ReactIntlMeta,
      } as ExtractionResult;

      let messagesFilename;
      if (
        messagesDir &&
        filename &&
        (messagesFilename = resolveOutputPath(
          workspaceRoot,
          messagesDir,
          filename
        )) &&
        (outputEmptyJson || descriptors.length)
      ) {
        outputJSONSync(messagesFilename, descriptors);
      }
    },

    visitor: {
      Program(path) {
        const {body} = path.node;
        const {ReactIntlMeta} = this;
        if (!pragma) {
          return;
        }
        for (const {leadingComments} of body) {
          if (!leadingComments) {
            continue;
          }
          const pragmaLineNode = leadingComments.find(c =>
            c.value.includes(pragma)
          );
          if (!pragmaLineNode) {
            continue;
          }

          pragmaLineNode.value
            .split(pragma)[1]
            .trim()
            .split(/\s+/g)
            .forEach(kv => {
              const [k, v] = kv.split(':');
              ReactIntlMeta[k] = v;
            });
        }
      },
      JSXOpeningElement(
        path,
        {
          opts,
          file: {
            opts: {filename},
          },
        }
      ) {
        const {
          moduleSourceName = 'react-intl',
          additionalComponentNames = [],
          removeDefaultMessage,
          idInterpolationPattern,
          overrideIdFn,
        } = opts;
        if (wasExtracted(path)) {
          return;
        }

        const name = path.get('name');

        if (name.referencesImport(moduleSourceName, 'FormattedPlural')) {
          if (path.node && path.node.loc)
            console.warn(
              `[React Intl] Line ${path.node.loc.start.line}: ` +
                'Default messages are not extracted from ' +
                '<FormattedPlural>, use <FormattedMessage> instead.'
            );

          return;
        }

        if (
          name.isJSXIdentifier() &&
          (referencesImport(name, moduleSourceName, DEFAULT_COMPONENT_NAMES) ||
            additionalComponentNames.includes(name.node.name))
        ) {
          const attributes = path
            .get('attributes')
            .filter(attr => attr.isJSXAttribute());

          const descriptorPath = createMessageDescriptor(
            attributes.map(attr => [
              attr.get('name') as NodePath<JSXIdentifier>,
              attr.get('value') as NodePath<StringLiteral>,
            ])
          );

          // In order for a default message to be extracted when
          // declaring a JSX element, it must be done with standard
          // `key=value` attributes. But it's completely valid to
          // write `<FormattedMessage {...descriptor} />`, because it will be
          // skipped here and extracted elsewhere. The descriptor will
          // be extracted only (storeMessage) if a `defaultMessage` prop.
          if (descriptorPath.id || descriptorPath.defaultMessage) {
            // Evaluate the Message Descriptor values in a JSX
            // context, then store it.
            const descriptor = evaluateMessageDescriptor(
              descriptorPath,
              true,
              filename,
              idInterpolationPattern,
              overrideIdFn
            );

            storeMessage(
              descriptor,
              path,
              opts,
              workspaceRoot,
              filename,
              this.ReactIntlMessages
            );

            let idAttr: NodePath<t.JSXAttribute> | undefined;
            let descriptionAttr: NodePath<t.JSXAttribute> | undefined;
            let defaultMessageAttr: NodePath<t.JSXAttribute> | undefined;
            for (const attr of attributes) {
              if (!attr.isJSXAttribute()) {
                continue;
              }
              switch (
                getMessageDescriptorKey(
                  (attr as NodePath<JSXAttribute>).get('name')
                )
              ) {
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
                idAttr.get('value').replaceWith(t.stringLiteral(descriptor.id));
              } else if (defaultMessageAttr) {
                defaultMessageAttr.insertBefore(
                  t.jsxAttribute(
                    t.jsxIdentifier('id'),
                    t.stringLiteral(descriptor.id)
                  )
                );
              }
            }

            // Tag the AST node so we don't try to extract it twice.
            tagAsExtracted(path);
          }
        }
      },

      CallExpression(
        path,
        {
          opts,
          file: {
            opts: {filename},
          },
        }
      ) {
        const {ReactIntlMessages: messages} = this;
        const {
          moduleSourceName = 'react-intl',
          overrideIdFn,
          idInterpolationPattern,
          removeDefaultMessage,
          extractFromFormatMessageCall,
        } = opts;
        const callee = path.get('callee');

        /**
         * Process MessageDescriptor
         * @param messageDescriptor Message Descriptor
         */
        function processMessageObject(
          messageDescriptor: NodePath<ObjectExpression>
        ) {
          assertObjectExpression(messageDescriptor, callee);

          if (wasExtracted(messageDescriptor)) {
            return;
          }

          const properties = messageDescriptor.get('properties') as NodePath<
            ObjectProperty
          >[];

          const descriptorPath = createMessageDescriptor(
            properties.map(
              prop =>
                [prop.get('key'), prop.get('value')] as [
                  NodePath<Identifier>,
                  NodePath<StringLiteral>
                ]
            )
          );

          // Evaluate the Message Descriptor values, then store it.
          const descriptor = evaluateMessageDescriptor(
            descriptorPath,
            false,
            filename,
            idInterpolationPattern,
            overrideIdFn
          );
          storeMessage(
            descriptor,
            messageDescriptor,
            opts,
            workspaceRoot,
            filename,
            messages
          );

          // Remove description since it's not used at runtime.
          messageDescriptor.replaceWith(
            t.objectExpression([
              t.objectProperty(
                t.stringLiteral('id'),
                t.stringLiteral(descriptor.id)
              ),
              ...(!removeDefaultMessage && descriptor.defaultMessage
                ? [
                    t.objectProperty(
                      t.stringLiteral('defaultMessage'),
                      t.stringLiteral(descriptor.defaultMessage)
                    ),
                  ]
                : []),
            ])
          );

          // Tag the AST node so we don't try to extract it twice.
          tagAsExtracted(messageDescriptor);
        }

        // Check that this is `betterDefineMessages` call
        if (callee.isIdentifier({name: 'betterDefineMessages'})) {
          const fileId = (path.get('arguments')[0] as NodePath<any>).node.value;

          const messagesArg = path.get('arguments')[1] as NodePath<any>;

          const properties = messagesArg.get('properties') as NodePath<
            ObjectProperty
          >[];

          properties.forEach(prop => {
            const key = prop.get('key') as NodePath<Identifier>;
            const value = prop.get('value') as NodePath<StringLiteral>;
            const id = `${fileId}.${key.node.name}`;
            const defaultMessage = getICUMessageValue(value, {
              isJSXSource: true,
            });
            storeMessage(
              {id, defaultMessage},
              messagesArg,
              opts,
              workspaceRoot,
              filename,
              messages
            );
          });

          // Tag the AST node so we don't try to extract it twice.
          tagAsExtracted(messagesArg);
        }

        // Check that this is `defineMessages` call
        if (
          isMultipleMessagesDeclMacro(callee, moduleSourceName) ||
          isSingularMessagesDeclMacro(callee, moduleSourceName)
        ) {
          const firstArgument = path.get('arguments')[0];
          const messagesObj = getMessagesObjectFromExpression(firstArgument);

          try {
            if (assertObjectExpression(messagesObj, callee)) {
              if (isSingularMessagesDeclMacro(callee, moduleSourceName)) {
                processMessageObject(messagesObj as NodePath<ObjectExpression>);
              } else {
                const properties = messagesObj.get('properties');
                if (Array.isArray(properties)) {
                  properties
                    .map(
                      prop => prop.get('value') as NodePath<ObjectExpression>
                    )
                    .forEach(processMessageObject);
                }
              }
            }
          } catch (e) {
            console.log('⚠️⚠️⚠️', e);
          }
        }

        // Check that this is `intl.formatMessage` call
        if (extractFromFormatMessageCall && isFormatMessageCall(callee, path)) {
          const messageDescriptor = path.get('arguments')[0];
          if (messageDescriptor.isObjectExpression()) {
            try {
              processMessageObject(messageDescriptor);
            } catch (e) {
              console.log('⚠️⚠️⚠️', e);
            }
          }
        }
      },
    },
  } as PluginObj<PluginPass<OptionsSchema> & State>;
});

function isMultipleMessagesDeclMacro(
  callee: NodePath<any>,
  moduleSourceName: string
) {
  return referencesImport(callee, moduleSourceName, ['defineMessages']);
}

function isSingularMessagesDeclMacro(
  callee: NodePath<any>,
  moduleSourceName: string
) {
  return referencesImport(callee, moduleSourceName, ['defineMessage']);
}

function getMessagesObjectFromExpression(
  nodePath: NodePath<any>
): NodePath<any> {
  let currentPath = nodePath;
  while (
    isTSAsExpression(currentPath.node) ||
    isTSTypeAssertion(currentPath.node) ||
    isTypeCastExpression(currentPath.node)
  ) {
    currentPath = currentPath.get('expression') as NodePath<any>;
  }
  return currentPath;
}
export {OptionsSchema} from './options';
