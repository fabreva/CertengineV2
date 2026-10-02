const {hashingMethod} = require('./common');

class Node{
    constructor(val, l, r, index) {
        this.value = val;
        this.left = l;
        this.right = r;
        this.index = index;
    }

}

class MerkleTreeRecursiveV4 {
    constructor(leavesData, toBeHashedLeaves= true, hashAlgo) {
        this.leavesIndexes = []
        this.hashAlgo = hashAlgo
        let leavesDataHashed
        if(toBeHashedLeaves){
            leavesDataHashed = [];
            for (const leave of leavesData){
                leavesDataHashed.push(hashingMethod(hashingMethod(leave, this.hashAlgo), this.hashAlgo));
            }
        }else{
            leavesDataHashed = leavesData;
        }


        if(leavesDataHashed.length===1){
            this.tree = new Node(leavesDataHashed[0], null, null, 1);
            this.leavesIndexes = [1];
        }else{
            this.tree = this.#buildTree(leavesDataHashed, [], 1, 0);
        }
    }
    loadTree(tree) {
        this.tree = tree.tree;
        this.leavesIndexes = tree.leavesIndexes;
    }

    #buildTree(valuesList, nodeList, index, height) {
        function getValue(value) {
            return typeof value === 'string' ? value : getValue(value.value);
        }

        if (valuesList.length === 0) {
            return null;
        }

        if (valuesList.length === 1) {
            return nodeList.length > 0 ? nodeList[0] : new Node(valuesList[0], null, null, index);
        }

        let nextValuesList = [];
        let nextNodeList = [];

        for (let i = 0; i < valuesList.length; i += 2) {
            if (i + 1 === valuesList.length) {
                let n;
                if (nodeList.length > 0){
                    n = nodeList[i]
                }else{
                    n = new Node(valuesList[i], null, null, index)
                    this.leavesIndexes.push(index)
                }
                nextNodeList.push(n);
                nextValuesList.push(n.value);
                break
            }

            let head1 = getValue(valuesList[i]);
            let head2 = getValue(valuesList[i + 1]);
            let upperHead = hashingMethod(head1 + head2, this.hashAlgo);

            let nLeft, nRight, nUp;

            if (nodeList.length === 0) {
                nLeft = new Node(valuesList[i], null, null, index);
                nRight = new Node(valuesList[i + 1], null, null, index + 2);
                nUp = new Node(upperHead, nLeft, nRight, nLeft.index + 1);

                this.leavesIndexes.push(index);
                this.leavesIndexes.push(index + 2);
                index = nRight.index + 2;
            } else {
                nLeft = nodeList[i];
                nRight = nodeList[i + 1];
                nUp = new Node(upperHead, nLeft, nRight, nLeft.index + 2 ** height);
            }

            nextNodeList.push(nUp);
            nextValuesList.push(upperHead);
        }

        return this.#buildTree(nextValuesList, nextNodeList, index, height + 1);
    }


    getMerkleRoot(){
        function getValue(value, target){
            if(typeof(value) == 'string'){
                target = value;
                return target;
            }
            else{
                return getValue(value.value, target);
            }
        }

        return getValue(this.tree.value);
    }

    #getProof(tree, leafIndex, proofs){
        function getValue(value, target){
            if(typeof(value) == 'string'){
                target = value;
                return target;
            }
            else{
                return getValue(value.value, target);
            }
        }

        const levelIDX = leafIndex[0];
        if (levelIDX<tree.index){
            const temp = {
                "right": getValue(tree.right.value)
            }
            proofs.unshift(temp);
            return this.#getProof(tree.left, leafIndex, proofs);
        }

        else if (levelIDX>tree.index){
            const temp = {
                "left": getValue(tree.left.value)
            };
            proofs.unshift(temp);
            return this.#getProof(tree.right, leafIndex, proofs);
        }

        else if (levelIDX === tree.index){
            if (leafIndex.length>1){
                leafIndex.shift();
                return this.#getProof(tree.value, leafIndex, proofs);
            }else{
                return proofs
            }
        }
        else{
            throw new RangeError("Leaf not in tree");
        }
    }


    computeHashRoot(leave, proof){
        let res = hashingMethod(hashingMethod(leave, this.hashAlgo), this.hashAlgo);

        for (let elem of proof){
            if (elem['right']){
                res = hashingMethod(res + elem['right'], this.hashAlgo);
            } else {
                res = hashingMethod(elem['left'] + res, this.hashAlgo);
            }
        }
        return res;
    }

    getMerkleProof(leafIndex) {
        return this.#getProof( this.tree, leafIndex,[]);
    }

}


module.exports = {
    MerkleTreeRecursiveV4
}
