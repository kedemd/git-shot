const OK = {
    _components: new Map(),
    register(component) {
        this._components.set(component.tag.toUpperCase(), component);
    },
    async load(node, component, props, initChildren = false, replaceTarget = null){
        node.innerHTML = '...';
        let template = await OK._loadTemplate(component);
        node.innerHTML = template;
        let context = await OK._loadContext(component, props);


        if (replaceTarget) {
            replaceTarget && replaceTarget.replaceWith(node);
        }
        if (initChildren){
            node.$scope.$props = props || node.$scope.$props;
            OK._initChildren(node, {$context: context});
        } else {
            OK.initNode(node, {
                $context: context,
                $props:
                props, $cache: {
                    isComponentInitialized: true
                }
            });
        }
        component.init && component.init(context);
    },
    async _loadTemplate(component) {
        let template = await Promise.resolve(component.template);

        if (template.startsWith('#')) {
            let templateNode = window.document.querySelector(template);
            if (!templateNode) {
                throw new Error('Template node not found');
            }
            template = templateNode.innerHTML;
        }
        component.template = template;
        return template;
    },
    async _loadContext(component, props) {
        let context = component.context;
        if (typeof context.then === 'function') {
            context = await context(props);
        } else if (typeof context === "function") {
            context = context(props);
        }

        return OKProxy.create(context);
    },
    createComponent(tag, props, target = null) {
        let component = OK._components.get(tag.toUpperCase());
        if (!component) {
            throw new Error('Missing component');
        }

        let el = document.createElement(tag);
        OK.load(el, component, props, false, target).then(()=>{});

        return el;
    },
    initNode(node, scope = null) {
        OK._prepareNode(node, scope);
        if (!OK._initIf(node)) {
            return;
        }
        OK._initAttributes(node);
        if (OK._initTextNode(node)) {
            return;
        }
        OK._initChildren(node);
        OK._initComponent(node);
    },
    _initAttributes(node) {
        if (!node.attributes) {
            return;
        }

        for (let attr of node.attributes) {
            if (attr.name.startsWith('on.')) {
                OK._initOn(node, attr);
            } else if (attr.name === 'of' || attr.name === 'for') {
                OK._initFor(node);
            } else if (attr.name === 'if') {

            } else {
                OK._initAttr(node, attr);
            }
        }
    },
    _initIf(node) {
        let ifContext = node.$scope.$cache.if;
        if (ifContext) {
            return !ifContext.placeholder;
        }

        let ifAttr = node.getAttributeNode && node.getAttributeNode('if');
        if (!ifAttr) {
            // This is not an if node
            return true;
        }

        ifContext = node.$scope.$cache.if = {
            originalTemplate: node.outerHTML,
            cmd: ifAttr.value,
            placeholder: null,
            original: node
        }

        let tracker = node.$scope.$trackers.if = node.$scope.$trackers.if || OKProxy.createTracker(`if(${ifContext.cmd})`);
        tracker.addEventListener('change', e => {
            let scope = ifContext.original && ifContext.original.$scope || ifContext.placeholder && ifContext.placeholder.$scope;
            if (!scope){
                return tracker.destroy();
            }
            tracker.clear();
            tracker.start();
            let result = OK._eval.call(scope.$context, scope, ifContext.cmd, true);
            tracker.stop();
            if (result && ifContext.placeholder){
                // The current node is a placeholder
                let container = document.createElement('div');
                container.innerHTML = ifContext.originalTemplate;
                let original = container.firstChild;
                OK._prepareNode(original, {
                    $trackers: { if: tracker },
                    $cache: { if : ifContext },
                    $context: ifContext.placeholder.$scope.$context
                }, ifContext.placeholder.parentNode);
                ifContext.placeholder.replaceWith(original);
                ifContext.placeholder.$scope.$trackers.if = null;
                OK.destroyNode(ifContext.placeholder);
                ifContext.placeholder = null;
                ifContext.original = original;
                OK.initNode(original);
            } else if (!result && !ifContext.placeholder) {
                // The current node is the original node
                this._replaceIfWithPlaceholder(ifContext, tracker);
            }
        });
        tracker.clear();
        tracker.start();
        let result = OK._eval.call(node.$scope.$context, node.$scope, ifContext.cmd, true);
        tracker.stop();
        if (!tracker._accessedPaths.length){
            tracker.destroy();
            node.$scope.$trackers.if = null;
        }

        if (!result){
            this._replaceIfWithPlaceholder(ifContext, tracker);
        }

        return result;
    },
    _replaceIfWithPlaceholder(ifContext, tracker){
        let original = ifContext.original;
        let placeholder = document.createComment(`if(${ifContext.cmd})`);
        OK._prepareNode(placeholder, {
            $cache: {if: ifContext },
            $trackers: { if: tracker },
            $context: original.$scope.$context
            },
            original.parentNode);
        if (original.$scope.$trackers && original.$scope.$trackers.if) {
            original.$scope.$trackers.if = null;
        }
        OK.destroyNode(original, false);
        original.replaceWith(placeholder);
        ifContext.original = null;
        ifContext.placeholder = placeholder;
    },
    _initFor(node) {
        if (node.$scope.$cache.for) {
            return;
        }

        let ofAttr = node.getAttributeNode && node.getAttributeNode('of');
        if (!ofAttr) {
            return;
        }

        let forAttr = node.getAttributeNode('for');
        let forContext = node.$scope.$cache.for = {
            for: forAttr.value || null,
            of: ofAttr.value,
            itemKeyToNode: new Map(),
            forTemplate: node.innerHTML,
        };

        node.$scope.$items = [];
        node.innerHTML = '';

        let tracker = node.$scope.$trackers.for = OKProxy.createTracker(`for ${forContext.for} of ${forContext.of}`);
        tracker.addEventListener('change', function(e) {
            let forContext = node.$scope.$cache.for;

            for (let change of e.changes) {
                if (change.property === 'length') {
                    for (let key of forContext.itemKeyToNode.keys()) {
                        if (!node.$scope.$items[key]) {
                            let nodesToRemove = forContext.itemKeyToNode.get(key);
                            for (let child of nodesToRemove) {
                                // Clear the child so it can be garbage collected
                                // Remove child trackers
                                child.remove();
                                OK.destroyNode(child);
                            }
                            forContext.itemKeyToNode.delete(key);
                        }
                    }
                } else {
                    let nodes = forContext.itemKeyToNode.get(change.property);
                    if (!nodes) {
                        nodes = OK._createTemplateNodes(forContext.forTemplate);
                        for (let currNode of nodes) {
                            OK._prepareNode(currNode, {
                                $index: change.property,
                                $key: change.property
                            }, node);
                        }

                        forContext.itemKeyToNode.set(change.property, [...nodes]);
                        node.append(...nodes);
                    }
                    for (let currNode of nodes) {
                        currNode.$scope.$item = change.newValue;
                        forContext.for && (currNode.$scope[forContext.for] = currNode.$scope.$item);
                        for(let tracker of Object.values(currNode.$scope.$trackers)){
                            if (tracker) {
                                tracker.destroy();
                            }
                        }
                        OK.initNode(currNode);
                    }
                }
            }
        });
        tracker.clear();
        tracker.start();
        let items = node.$scope.$items = OK._eval.call(node.$scope.$context, node.$scope, forContext.of);
        tracker.stop();

        let i = 0;
        for (let [key, item] of Object.entries(items)) {
            let nodes = OK._createTemplateNodes(forContext.forTemplate);
            for (let currNode of nodes) {
                OK._prepareNode(currNode, {
                    $key: key,
                    $index: i,
                    $item: item,
                }, node);
                forContext.for && (currNode.$scope[forContext.for] = item);
            }
            forContext.itemKeyToNode.set(key, nodes);
            node.append(...nodes);
            i++;
        }
    },
    _createTemplateNodes(template) {
        let container = document.createElement('div');
        container.innerHTML = template;
        return [...container.childNodes];
    },
    _initAttr(node, attr) {
        let attributes = node.$scope.$cache.attributes || (node.$scope.$cache.attributes = {});
        if (attributes[attr.name]) {
            return;
        }

        let attribute = attributes[attr.name] = {
            name: attr.name,
            cmd: attr.value,
            value: null,
        }
        let tracker = node.$scope.$trackers[attr.name] = OKProxy.createTracker(`${attribute.name}: ${attribute.cmd}`);
        tracker.clear();
        tracker.start();
        let result = OK._evalText(node.$scope, attribute.cmd);
        attribute.value = result;
        attr.value = attribute.value;
        tracker.stop();
        if (tracker._accessedPaths.length) {
            tracker.addEventListener('change', e => {
                tracker.clear();
                tracker.start();
                let result = OK._evalText(node.$scope, attribute.cmd);
                attribute.value = result;
                attr.value = attribute.value;
                tracker.stop();
            });
        }
        if (!tracker._accessedPaths.length){
            tracker.destroy();
            node.$scope.$trackers[attr.name] = null;
        }
    },
    _initTextNode(node) {
        if (node.nodeType !== Node.TEXT_NODE) {
            return false;
        }
        if (node.$scope.$cache.text) {
            return false;
        }

        let tracker = node.$scope.$trackers['text'] = OKProxy.createTracker('text: ' + node.textContent);
        let text = node.$scope.$cache.text = {
            originalText: node.textContent
        };

        tracker.clear();
        tracker.start();
        node.textContent = OK._evalText(node.$scope, text.originalText);
        tracker.stop();
        if (!tracker._accessedPaths.length){
            tracker.destroy();
            node.$scope.$trackers['text'] = null;
        } else {
            tracker.addEventListener('change', e => {
                tracker.clear();
                tracker.start();
                node.textContent = OK._evalText(node.$scope, text.originalText);
                tracker.stop();
            });
        }

        return true;
    },
    _initChildren(node, scope) {
        for (let currNode of node.childNodes) {
            OK._prepareNode(currNode, scope, node);
            OK.initNode(currNode);
        }
    },
    _initOn(node, onAttr) {
        if (node.$scope.$cache.on && node.$scope.$cache.on[onAttr.name]) {
            return;
        }
        node.$scope.$cache.on = node.$scope.$cache.on || {};
        let onContext = node.$scope.$cache.on[onAttr.name] = {
            cmd: onAttr.value,
            action: onAttr.name.slice(3),
        }

        let handler = function(){
            let result = OK._eval.call(node.$scope.$context, node.$scope, onAttr.value);
            if (typeof result === "function") {
                return result.call(node.$scope.$context, ...arguments);
            }
        };
        node.$scope.$listeners.push({ action: onContext.action, handler});
        node.addEventListener(onContext.action, handler);
    },
    _initComponent(node) {
        if (!node.tagName) {
            return;
        }
        if (node.$scope.$cache.isComponentInitialized) {
            return;

        }
        node.$scope.$cache.isComponentInitialized = true;

        let component = OK._components.get(node.tagName.toUpperCase());
        if (!component) {
            return;
        }

        let props = {};
        props.children = [...node.childNodes];
        if (node.$scope.$cache.attributes) {
            for (let [key, attr] of Object.entries(node.$scope.$cache.attributes)) {
                props[key] = attr.value
                let tracker = node.$scope.$trackers[key];
                if (!tracker){
                    continue;
                }

                tracker.addEventListener('change', e => {
                    for (let [key, attr] of Object.entries(node.$scope.$cache.attributes)){
                        props[key] = attr.value
                    }
                    node.$scope.$props = props;

                    OK.load(node, component, props, true, null).then(() => {});
                });
            }
        }
        node.$scope.$props = props;
        OK.load(node, component, props, true, null).then(() => {});
    },
    _prepareNode(node, scopeOverride = {}, parentNode) {
        if (node.$scope) {
            return node;
        }

        let parentScope = parentNode?.$scope || node.parentNode?.$scope;
        node.$scope = Object.assign({
                $el: null,
                $root: null,
                $parent: null,
                $context: {}
            },
            parentScope,
            {
                $el: node,
                $parent: parentScope,
                $props: {},
                $cache: {},
                $trackers: {},
                $listeners: []
            },
            scopeOverride,
        );
        node.$scope.$root = parentScope && parentScope.$root || node.$scope;

        return node;
    },
    destroyNode(node, remove = true) {
        for (let childNode of node.childNodes) {
            OK.destroyNode(childNode, false);
        }
        if (node.$scope) {
            for (let currTracker of Object.values(node.$scope.$trackers)) {
                currTracker && currTracker.destroy();
            }
            for(let currListener of node.$scope.$listeners){
                node.removeEventListener(currListener.action, currListener.handler);
            }
            if(node.$scope.$cache.for){
                node.$scope.$cache.for.itemKeyToNode.clear();
            }
            for(let key of Object.keys(node.$scope)) {
                node.$scope[key] = null;
            }
        }
        node.$scope = null;

        if (remove) {
            node.remove();
        }
    },
    _eval(scope, script, ignoreReferenceError = false) {
        let result = null;

        try {
            with(scope.$context){
                with (scope){
                    return eval(script);
                }
            }
        } catch (e) {
            if (e.name === 'ReferenceError' && ignoreReferenceError) {
                return false;
            }

            console.log(e);
        }

        return result;
    },
    _evalText(scope, text) {
        let openIndex = -1;
        let openCount = 0;
        let closeIndex = -1;
        let outString = '';
        let trackBraces = '';

        for (let i = 0; i < text.length; i++) {
            if (text[i] === '{' && text[i - 1] !== '\\') {
                if (!openCount) {
                    openIndex = i;
                }
                openCount++;
            } else if (text[i] === '}' && text[i - 1] !== '\\') {
                if (openCount) {
                    openCount--;
                    if (!openCount) {
                        closeIndex = i;
                        trackBraces += '}';
                    }
                }
            }
            if (closeIndex > -1) {
                let result = OK._eval.call(scope.$context, scope, trackBraces);
                if (trackBraces === text) {
                    outString = result;
                } else {
                    outString += result ? result : '';
                }

                trackBraces = '';
                closeIndex = -1;
                openIndex = -1;
            } else if (openIndex > -1) {
                trackBraces += text[i];
            } else {
                outString += text[i];
            }
        }
        return outString;
    },
}